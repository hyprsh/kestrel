import type { components } from '../api/schema.gen'
import { displayDefaults, noDisplayDeclared } from './display'
import { http } from './handlers'
import { server } from './server'

type Schemas = components['schemas']
export type Slot = Schemas['Slot']

export const slot = (id: string, label: string, position: number, over: Partial<Slot> = {}): Slot => ({
  id,
  label,
  default_movies: 'hd-primary',
  default_series: 'hd-primary',
  on_for_new_titles: id === 'standard',
  position,
  from_config_file: false,
  ...over,
})

export const seededSlots = (): Slot[] => [slot('standard', 'Standard', 0), slot('4k', '4K', 1, { default_movies: '4k-primary', default_series: '4k-primary' })]

const profile = (key: string, name: string, over: Partial<Schemas['Profile']> = {}): Schemas['Profile'] => ({
  key,
  name,
  language_rule: 'primary',
  original_language: 'reject',
  original_fallback: false,
  from_config_file: false,
  enabled: true,
  default_movies: false,
  default_series: false,
  min_height: 0,
  max_height: 1080,
  trash_profile_movies: 'hd-bluray-web',
  trash_profile_series: 'web-1080p',
  ...over,
})

export const profiles = (): Schemas['Profile'][] => [profile('hd-primary', 'HD'), profile('any-primary', 'Any'), profile('4k-primary', '4K', { min_height: 2160, max_height: 2160 })]

const problem = (status: number, code: string, detail: string, errors: { field: string; code: string; message: string }[] = []) => ({ type: 'about:blank', title: 'x', status, code, detail, errors })

export type Sent = { path: string; body?: unknown }

/**
 * The Slot API with the rules the screen leans on (a taken label is a 422 on `label`, the last Slot a 409), the Profiles,
 * and a Library of `titles` rows. Everything the screen sends is in `sent`.
 */
export function fakeSlots(opts: { slots?: Slot[]; warnings?: Schemas['SettingsWarning'][]; titles?: Schemas['TitleRow'][]; files?: number } = {}) {
  const sent: Sent[] = []
  let slots = opts.slots ?? seededSlots()
  const titles = opts.titles ?? []
  const renumber = () => (slots = slots.map((s, i) => ({ ...s, position: i })))
  const rules = (label: string | undefined, self?: string) => {
    if (label === undefined) return null
    if (label.trim() === '') return problem(422, 'validation', 'invalid label', [{ field: 'label', code: 'invalid', message: 'must not be empty' }])
    if (slots.some((s) => s.id !== self && s.label.toLowerCase() === label.toLowerCase()))
      return problem(422, 'validation', 'invalid label', [{ field: 'label', code: 'conflict', message: 'is already a Slot' }])
    return null
  }
  server.use(
    http.get('/slots', ({ response }) => response(200).json({ items: slots })),
    http.get('/profiles', ({ response }) => response(200).json({ items: profiles() })),
    http.get('/titles', ({ response }) => response(200).json({ items: titles, next_cursor: null })),
    http.get('/settings', ({ response }) =>
      response(200).json({
        language_region: { primary_language: 'en', release_date_country: 'US' },
        check_github_updates: true,
        pause_grabs: false,
        display: displayDefaults,
        from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
        trash: { auto_update: true },
        metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        root_folders: { movies: ['/m'], series: ['/s'] },
        ...(opts.warnings ? { warnings: opts.warnings } : {}),
      }),
    ),
    http.post('/slots', async ({ request, response }) => {
      const body = (await request.json()) as { label: string; default_movies?: string; default_series?: string; on_for_new_titles?: boolean }
      sent.push({ path: 'POST /slots', body })
      const bad = rules(body.label)
      if (bad) return response('default').json(bad, { status: 422 })
      if (slots.length >= 4) return response('default').json(problem(422, 'validation', 'a library has at most 4 Slots'), { status: 422 })
      const made = slot(body.label.toLowerCase().replace(/\s+/g, '-'), body.label, slots.length, {
        default_movies: body.default_movies || null,
        default_series: body.default_series || null,
        on_for_new_titles: body.on_for_new_titles ?? false,
      })
      slots = [...slots, made]
      return response(201).json(made)
    }),
    http.patch('/slots/{id}', async ({ request, params, response }) => {
      const body = (await request.json()) as Partial<Slot>
      const dry = new URL(request.url).searchParams.get('dry_run') === 'true'
      sent.push({ path: `PATCH /slots/${params.id}${dry ? '?dry_run=true' : ''}`, body })
      const cur = slots.find((s) => s.id === params.id)!
      const bad = rules(body.label, cur.id)
      if (bad) return response('default').json(bad, { status: 422 })
      if (body.on_for_new_titles === false && cur.on_for_new_titles && slots.filter((s) => s.on_for_new_titles).length === 1)
        return response('default').json(problem(409, 'conflict', 'at least one Slot must be on for new Titles'), { status: 409 })
      const next: Slot = { ...cur, ...body }
      const renames = body.label !== undefined && body.label !== cur.label ? { renames_files: opts.files ?? 0 } : {}
      if (!dry) {
        slots = slots.map((s) => (s.id === cur.id ? next : s))
        if (body.position !== undefined) {
          slots = slots.filter((s) => s.id !== cur.id)
          slots.splice(body.position, 0, next)
          renumber()
        }
      }
      return response(200).json({ ...next, ...renames })
    }),
    http.delete('/slots/{id}', ({ params, response }) => {
      sent.push({ path: `DELETE /slots/${params.id}` })
      const cur = slots.find((s) => s.id === params.id)!
      if (slots.length === 1) return response('default').json(problem(409, 'conflict', 'a library needs at least one Slot'), { status: 409 })
      if (titles.some((t) => t.slot_states.some((s) => s.slot === cur.id))) return response('default').json(problem(409, 'conflict', 'the Slot still holds Versions'), { status: 409 })
      slots = slots.filter((s) => s.id !== cur.id)
      renumber()
      return response(204).empty()
    }),
    http.post('/titles/bulk', async ({ request, response }) => {
      const body = (await request.json()) as { action: string; title_ids: number[]; slot?: string }
      sent.push({ path: `bulk ${body.action}`, body })
      return response(200).json({ items: body.title_ids.map((title_id) => ({ title_id, outcome: 'changed' as const, reason: null })) })
    }),
  )
  return sent
}

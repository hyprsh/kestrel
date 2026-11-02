import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type Schemas = components['schemas']
export type TitleRow = Schemas['TitleRow']
export type TitleDetail = Schemas['TitleDetail']
export type LookupResult = Schemas['LookupResult']
export type Suggestion = Schemas['LookupDetail']
export type Sent = { path: string; body: unknown }

/** A Slot of a fixture row: what the list says of a Version, as the tests write it. */
export type FixtureSlot = { version_id: number; profile: string; state: Schemas['SlotState']; long_missing: boolean; last_search?: Schemas['LastSearch'] | null; next_search_at?: string | null }
/** A fixture row also carries `slots`, the short form the tests write; `slot_states` is derived from it and `slots` never reaches the app. */
export type FixtureRow = TitleRow & { slots: { standard: FixtureSlot | null; '4k': FixtureSlot | null } }

const slot = (profile: string, state: Schemas['SlotState'], id: number): FixtureSlot => ({
  version_id: id,
  profile,
  state,
  long_missing: false,
})

/** The list form of a row's fixed Slots, as the server derives it. */
const slotStates = (slots: FixtureRow['slots']): TitleRow['slot_states'] =>
  (['standard', '4k'] as const).flatMap((k) => {
    const s = slots[k]
    return s
      ? [
          {
            slot: k,
            label: k === '4k' ? '4K' : 'Standard',
            version_id: s.version_id,
            profile: s.profile,
            state: s.state,
            long_missing: s.long_missing,
            upgrade_wanted: false,
            last_search: s.last_search,
            next_search_at: s.next_search_at,
          },
        ]
      : []
  })

export const row = (id: number, title: string, primary: string, over: Partial<FixtureRow> = {}): FixtureRow => {
  const slots = over.slots ?? { standard: slot('hd-primary', 'wanted', id * 10 + 1), '4k': null }
  return {
    id,
    kind: 'movie',
    title,
    primary_title: primary,
    year: 2014,
    has_poster: false,
    monitored: true,
    slots,
    slot_states: over.slot_states ?? slotStates(slots),
    wanted_since: '2026-10-17T12:00:00Z',
    added_at: '2026-10-17T12:00:00Z',
    size: 0,
    searched_at: null,
    wanted_episodes: null,
    ...over,
  }
}

export const detail = (r: TitleRow & Partial<Pick<FixtureRow, 'slots'>>, over: Partial<TitleDetail> = {}): TitleDetail => ({
  id: r.id,
  kind: 'movie',
  tmdb_id: 100 + r.id,
  tvdb_id: null,
  imdb_id: `tt00000${r.id}`,
  title: r.title,
  original_title: r.title,
  primary_title: r.primary_title,
  year: r.year,
  original_language: 'en',
  overview: `About ${r.title}.`,
  runtime: 95,
  has_poster: r.has_poster,
  monitored: true,
  metadata_frozen: false,
  root_folder: '/data/media/movies',
  folder: null,
  added_at: r.added_at,
  refreshed_at: r.added_at,
  certification: 'PG',
  release_dates: [],
  series_monitor: null,
  seasons: [],
  requests: [],
  ratings: [],
  versions: (['standard', '4k'] as const).flatMap((s) => {
    const sl = r.slots ? r.slots[s] : r.slot_states.find((e) => e.slot === s)
    return sl ? [{ id: sl.version_id, slot: s, profile: sl.profile, state: sl.state, long_missing: false, wanted_since: r.wanted_since, file: null, added_at: r.added_at }] : []
  }),
  ...over,
})

const profileNames: Record<string, string> = {
  'hd-primary': 'HD',
  'any-primary': 'Any',
  '4k-primary': '4K',
}

/** A Library of titles served by GET /titles and GET /titles/{id}. */
export function fakeLibrary(initial: (TitleRow & Partial<Pick<FixtureRow, 'slots'>>)[]) {
  const state = { rows: initial, sent: [] as Sent[] }
  server.use(
    http.get('/titles', ({ response }) => response(200).json({ items: state.rows.map(({ slots: _slots, ...listed }) => listed), next_cursor: null })),
    http.get('/titles/{id}', ({ params, response }) => {
      const r = state.rows.find((x) => x.id === Number(params.id))
      return r ? response(200).json(detail(r)) : response('default').json({ type: 'about:blank', title: 'not found', status: 404, code: 'not_found' }, { status: 404 })
    }),
    http.get('/profiles', ({ response }) =>
      response(200).json({
        items: Object.entries(profileNames).map(([key, name]) => ({
          key,
          name,
          slot: key.startsWith('4k') ? '4k' : 'standard',
          release_family: 'bluray-web',
          kinds: ['movie', 'series'],
          language_rule: 'primary',
          original_language: 'reject',
          original_fallback: false,
          from_config_file: false,
          enabled: true,
          default_movies: key === 'hd-primary',
          default_series: key === 'hd-primary',
          min_height: 0,
          max_height: 1080,
          trash_profile_movies: 'hd-bluray-web',
          trash_profile_series: 'web-1080p',
        })),
      }),
    ),
  )
  return state
}

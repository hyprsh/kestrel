import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type Schemas = components['schemas']
export type TitleRow = Schemas['TitleRow']
export type TitleDetail = Schemas['TitleDetail']
export type LookupResult = Schemas['LookupResult']
export type Suggestion = Schemas['LookupDetail']
export type Sent = { path: string; body: unknown }

const slot = (profile: string, state: Schemas['SlotState'], id: number): Schemas['SlotSummary'] => ({
  version_id: id,
  profile,
  state,
  long_missing: false,
})

export const row = (id: number, title: string, primary: string, over: Partial<TitleRow> = {}): TitleRow => ({
  id,
  kind: 'movie',
  title,
  primary_title: primary,
  year: 2014,
  slots: { sd: null, hd: slot('hd-primary', 'wanted', id * 10 + 1), uhd: null },
  wanted_since: '2026-10-17T12:00:00Z',
  added_at: '2026-10-17T12:00:00Z',
  ...over,
})

export const detail = (r: TitleRow, over: Partial<TitleDetail> = {}): TitleDetail => ({
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
  has_poster: false,
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
  versions: (['sd', 'hd', 'uhd'] as const).flatMap((s) => {
    const sl = r.slots[s]
    return sl
      ? [{ id: sl.version_id, slot: s, profile: sl.profile, state: sl.state, long_missing: false, wanted_since: r.wanted_since, file: null, added_at: r.added_at }]
      : []
  }),
  ...over,
})

export const profileNames: Record<string, string> = {
  'sd-primary': 'SD',
  'hd-primary': 'HD',
  'kids-primary': 'Kids',
  'uhd-primary': 'UHD',
}

/** A Library of titles served by GET /titles and GET /titles/{id}. */
export function fakeLibrary(initial: TitleRow[]) {
  const state = { rows: initial, sent: [] as Sent[] }
  server.use(
    http.get('/titles', ({ response }) => response(200).json({ items: state.rows, next_cursor: null })),
    http.get('/titles/{id}', ({ params, response }) => {
      const r = state.rows.find((x) => x.id === Number(params.id))
      return r
        ? response(200).json(detail(r))
        : response('default').json({ type: 'about:blank', title: 'not found', status: 404, code: 'not_found' }, { status: 404 })
    }),
    http.get('/profiles', ({ response }) =>
      response(200).json({
        items: Object.entries(profileNames).map(([key, name]) => ({
          key,
          name,
          slot: key.startsWith('sd') ? 'sd' : key.startsWith('uhd') ? 'uhd' : 'hd',
          language_rule: 'primary',
          original_fallback: false,
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

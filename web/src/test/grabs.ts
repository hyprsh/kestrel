import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type GrabEntry = components['schemas']['GrabEntry']
type Blocked = components['schemas']['BlocklistEntry']
type GrabSteps = components['schemas']['GrabSteps']

/** A Grab of the Movie Paddington (Title 5) in Standard that was imported an hour ago. */
export const grabEntry = (over: Partial<GrabEntry> = {}): GrabEntry => ({
  grab_id: 21,
  title_id: 5,
  has_poster: false,
  version_id: 11,
  title: 'Paddington',
  year: 2014,
  kind: 'movie',
  slot: 'standard',
  episodes: [],
  episode_ids: [],
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  indexer: 'NZBgeek',
  size: 8 * 1024 ** 3,
  score: 1450,
  is_upgrade: false,
  state: 'imported',
  failure: null,
  blocklist_reason: null,
  stalled: null,
  grabbed_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  updated_at: new Date(Date.now() - 3600_000).toISOString(),
  ...over,
})

/** A Blocklist entry made by "Cancel and Blocklist", so with no Grab left behind. */
export const blockedEntry = (over: Partial<Blocked> = {}): Blocked => ({
  id: 7,
  release_name: 'Paddington.2014.1080p.BluRay.x264-BAD',
  indexer_id: 1,
  reason: 'canceled and blocklisted',
  size: 1,
  published_at: new Date(Date.now() - 86_400_000).toISOString(),
  created_at: new Date(Date.now() - 600_000).toISOString(),
  title_id: 5,
  grab_id: null,
  ...over,
})

/** Whether a Grab passes the server's `q`, `kind`, `slot`, `grab`, `day`, `from` and `to` filters (`indexer` is not checked: a Grab has no indexer id). */
function passes(g: GrabEntry, q: URLSearchParams): boolean {
  const words = (q.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const kinds = q.getAll('kind')
  const slots = q.getAll('slot')
  const ids = q.getAll('grab')
  const days = q.getAll('day')
  const day = g.updated_at.slice(0, 10)
  return (
    (days.length === 0 || days.includes(day)) &&
    (!q.get('from') || day >= q.get('from')!) &&
    (!q.get('to') || day <= q.get('to')!) &&
    words.every((w) => [g.title, g.release_name, g.indexer].some((h) => h.toLowerCase().includes(w))) &&
    (kinds.length === 0 || (g.kind !== null && kinds.includes(g.kind))) &&
    (slots.length === 0 || (g.slot !== null && slots.includes(g.slot))) &&
    (ids.length === 0 || ids.includes(String(g.grab_id)))
  )
}

/**
 * GET /grabs answering the Activity screen's reads (finished Grabs a page at a time, stalled Imports) from
 * `grabs` by state, filter and `limit`/`cursor` (the cursor is the offset); GET /grabs/summary counting the
 * finished ones; and GET /blocklist serving `blocked`. Returns the queries the screen sent.
 */
export function fakeGrabs(grabs: GrabEntry[], blocked: Blocked[] = []) {
  const state = { grabs, queries: [] as URLSearchParams[] }
  const finished = (q: URLSearchParams) => state.grabs.filter((g) => (g.state === 'imported' || g.state === 'failed') && passes(g, q))
  server.use(
    http.get('/grabs/summary', ({ request, response }) => {
      const list = finished(new URL(request.url).searchParams)
      const times = list.map((g) => g.updated_at).sort()
      return response(200).json({ imported: list.filter((g) => g.state === 'imported').length, failed: list.filter((g) => g.state === 'failed').length, oldest: times[0] ?? null })
    }),
    http.get('/grabs', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      state.queries.push(q)
      const states = q.getAll('state')
      const stalled = q.get('stalled')
      const all = state.grabs.filter((g) => (states.length === 0 || states.includes(g.state)) && (stalled === null || (g.stalled !== null) === (stalled === 'true')) && passes(g, q))
      const from = Number(q.get('cursor') ?? 0)
      const limit = Number(q.get('limit') ?? 100)
      const items = all.slice(from, from + limit)
      return response(200).json({ items, next_cursor: from + limit < all.length ? String(from + limit) : null })
    }),
    http.get('/blocklist', ({ response }) => response(200).json({ items: blocked })),
  )
  return state
}

/** What happened to a Grab, grabbed by the search pass an hour and a half ago and imported a minute ago, with its Movie file. */
export const stepsOf = (over: Partial<GrabSteps> = {}): GrabSteps => ({
  grab_id: 21,
  grabbed_at: new Date(Date.now() - 90 * 60_000).toISOString(),
  grabbed_by: 'by_search',
  download_started_at: new Date(Date.now() - 85 * 60_000).toISOString(),
  download_finished_at: new Date(Date.now() - 75 * 60_000).toISOString(),
  ended_at: new Date(Date.now() - 60_000).toISOString(),
  files: [{ episode: null, path: '/media/movies/Paddington (2014)/Paddington (2014) - [Bluray-1080p].mkv' }],
  formats: [{ name: 'Remux Tier 01', points: 1600 }],
  quality: 'Bluray-1080p',
  video_codec: 'H.264',
  hdr: null,
  audio_codec: 'DTS-HD MA',
  audio_channels: '5.1',
  release_group: 'GRP',
  blocklist_id: null,
  still_wanted: false,
  ...over,
})

/** GET /grabs/{id}/steps answering from `steps` by Grab id, and DELETE /blocklist/{id} recording the ids removed. */
export function fakeSteps(steps: GrabSteps[]) {
  const state = { asked: [] as number[], unblocked: [] as number[] }
  server.use(
    http.get('/grabs/{id}/steps', ({ params, response }) => {
      state.asked.push(Number(params.id))
      const s = steps.find((x) => x.grab_id === Number(params.id))
      return s ? response(200).json(s) : response('default').json({ type: 'about:blank', title: 'x', status: 404, code: 'not_found', detail: 'no such Grab' }, { status: 404 })
    }),
    http.delete('/blocklist/{id}', ({ params, response }) => (state.unblocked.push(Number(params.id)), response(204).empty())),
  )
  return state
}

type ReleaseList = components['schemas']['ReleaseList']

/** A manual search's answer: the Releases and indexer errors given, searched now by one indexer, with nothing Wanted unless `over` says so. */
export const releaseList = (over: Partial<ReleaseList> = {}): ReleaseList => ({
  items: [],
  indexer_errors: [],
  searched_at: new Date().toISOString(),
  indexers_searched: 1,
  wanted: 0,
  cached: false,
  ...over,
})

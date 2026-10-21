import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type GrabEntry = components['schemas']['GrabEntry']
type Blocked = components['schemas']['BlocklistEntry']

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

/** A Blocklist entry made by "Cancel and blocklist", so with no Grab left behind. */
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

/**
 * GET /grabs answering the Activity screen's two reads (finished Grabs, stalled Imports) from
 * `grabs` by state, and GET /blocklist serving `blocked`. Returns the queries the screen sent.
 */
export function fakeGrabs(grabs: GrabEntry[], blocked: Blocked[] = []) {
  const state = { grabs, queries: [] as URLSearchParams[] }
  server.use(
    http.get('/grabs', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      state.queries.push(q)
      const states = q.getAll('state')
      const stalled = q.get('stalled')
      const items = state.grabs.filter(
        (g) => (states.length === 0 || states.includes(g.state)) && (stalled === null || (g.stalled !== null) === (stalled === 'true')),
      )
      return response(200).json({ items, next_cursor: null })
    }),
    http.get('/blocklist', ({ response }) => response(200).json({ items: blocked })),
  )
  return state
}

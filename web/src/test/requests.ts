import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type Request = components['schemas']['Request']
type RequestSlot = components['schemas']['RequestSlot']

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

/** A Slot of a Request, still searching for its Version 11. */
export const requestSlot = (over: Partial<RequestSlot> = {}): RequestSlot => ({
  slot: 'standard',
  profile: 'hd-primary',
  version_id: 11,
  status: 'queued',
  status_label: 'Searching',
  download: null,
  ...over,
})

/** Anna's Request via Silo, two hours ago, for the Movie Paddington (Title 5) in Standard. */
export const request = (over: Partial<Request> = {}): Request => ({
  id: 1,
  source: 'silo',
  source_request_id: 'r-1',
  requester: { id: 'u-1', name: 'Anna' },
  outcome: 'accepted',
  reject_reason: null,
  title_id: 5,
  title: 'Paddington',
  has_poster: false,
  seasons: [],
  created_at: hoursAgo(2),
  slots: [requestSlot()],
  ...over,
})

/**
 * GET /requests serving `items` newest first, `limit` at a time, as matching every filter (the
 * server filters). It records each call's query so a test can see what was asked for.
 */
export function fakeRequests(items: Request[], total = items.length) {
  const queries: URLSearchParams[] = []
  server.use(
    http.get('/requests', ({ request: r, response }) => {
      const q = new URL(r.url).searchParams
      queries.push(q)
      const from = Number(q.get('cursor') ?? 0)
      const to = from + Number(q.get('limit') ?? 100)
      return response(200).json({ items: items.slice(from, to), next_cursor: to < items.length ? String(to) : null, total })
    }),
  )
  return queries
}

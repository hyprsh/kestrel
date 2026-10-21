import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

export type QueueItem = components['schemas']['QueueItem']

/** An active Grab of the Movie Paddington (Title 5), three quarters downloaded. */
export const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  grab_id: 1,
  title_id: 5,
  has_poster: false,
  version_id: 11,
  title: 'Paddington',
  year: 2014,
  slot: 'standard',
  episodes: [],
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  phase: 'downloading',
  bytes_total: 8000,
  bytes_left: 2000,
  eta: 125,
  is_upgrade: false,
  score_delta: null,
  ...over,
})

/** GET /queue serving `items`, and POST /grabs/{id}/cancel taking a Grab off it and recording the request. */
export function fakeQueue(items: QueueItem[]) {
  const state = { items, cancels: [] as { id: string; body: unknown }[] }
  server.use(
    http.get('/queue', ({ response }) => response(200).json({ items: state.items })),
    http.post('/grabs/{id}/cancel', async ({ params, request, response }) => {
      const text = await request.clone().text()
      state.cancels.push({ id: String(params.id), body: text ? JSON.parse(text) : null })
      state.items = state.items.filter((i) => String(i.grab_id) !== String(params.id))
      return response(204).empty()
    }),
  )
  return state
}

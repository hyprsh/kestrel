import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { detail, fakeLibrary, row, type Sent, type TitleRow } from './library'
import { server } from './server'

type Episode = components['schemas']['Episode']
type Mode = components['schemas']['SeriesMonitor']

const cell = (state: components['schemas']['SlotState'], score: number | null = null) => ({ state, score })

export const episode = (id: number, season: number, number: number, name: string, over: Partial<Episode> = {}): Episode => ({
  id,
  season,
  number,
  name,
  air_date: '2008-01-20',
  monitored: season > 0,
  cells: { standard: cell(season > 0 ? 'wanted' : 'unmonitored'), '4k': cell(season > 0 ? 'wanted' : 'unmonitored') },
  ...over,
})

export const seriesRow = (id: number, title: string): TitleRow =>
  row(id, title, title, {
    kind: 'series',
    slots: {
      standard: { version_id: id * 10 + 1, profile: 'hd-primary', state: 'wanted', long_missing: false },
      '4k': { version_id: id * 10 + 2, profile: '4k-primary', state: 'wanted', long_missing: false },
    },
  })

/**
 * A Library holding one Series with a Special and two aired episodes of season 1,
 * served with the monitoring endpoints. `sent` records every monitoring call.
 */
export function fakeSeries() {
  const r = seriesRow(5, 'Breaking Bad')
  const lib = fakeLibrary([r])
  const state = {
    mode: 'all' as Mode,
    episodes: [
      episode(1, 0, 1, 'Good Cop Bad Cop'),
      episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120), '4k': cell('wanted') } }),
      episode(3, 1, 2, "Cat's in the Bag...", { air_date: null, cells: { standard: cell('unreleased'), '4k': cell('unreleased') } }),
    ],
    sent: [] as Sent[],
  }
  const seasons = () =>
    [0, 1].map((n) => ({ number: n, monitored: state.episodes.some((e) => e.season === n && e.monitored) }))
  server.use(
    http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: state.mode, seasons: seasons() }))),
    http.get('/titles/{id}/episodes', ({ response }) => response(200).json({ items: state.episodes })),
    http.post('/titles/{id}/episodes/monitor', async ({ request, response }) => {
      const body = await request.json()
      state.sent.push({ path: 'episodes/monitor', body })
      state.episodes = state.episodes.map((e) => (body.episode_ids.includes(e.id) ? { ...e, monitored: body.monitored } : e))
      return response(204).empty()
    }),
    http.patch('/titles/{id}/seasons/{season}', async ({ params, request, response }) => {
      const body = await request.json()
      state.sent.push({ path: `seasons/${params.season}`, body })
      state.episodes = state.episodes.map((e) => (e.season === Number(params.season) ? { ...e, monitored: body.monitored } : e))
      return response(204).empty()
    }),
    http.patch('/titles/{id}', async ({ request, response }) => {
      const body = await request.json()
      state.sent.push({ path: 'titles', body })
      if (body.series_monitor) state.mode = body.series_monitor
      return response(200).json(detail(r, { kind: 'series', series_monitor: state.mode, seasons: seasons() }))
    }),
  )
  return { ...state, lib, get: () => state }
}

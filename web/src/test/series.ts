import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { detail, fakeLibrary, row, type Sent, type TitleRow } from './library'
import { server } from './server'

type Episode = components['schemas']['Episode']
type Mode = components['schemas']['SeriesMonitor']

type EpisodeFile = components['schemas']['EpisodeFile']

/** An episode file with the facts a Movie's file has; `over` sets what a test cares about. */
export const episodeFile = (over: Partial<EpisodeFile> & Pick<EpisodeFile, 'id' | 'path' | 'size' | 'quality' | 'episode_ids'>): EpisodeFile => ({
  release_name: 'Breaking.Bad.S01E01.1080p.WEB-DL.DD5.1.H.264-NTb',
  languages: [],
  imported_at: '2024-10-20T12:00:00Z',
  custom_formats: [],
  ...over,
})

export const cell = (state: components['schemas']['SlotState'], score: number | null = null, file: EpisodeFile | null = null, last_search: components['schemas']['LastSearch'] | null = null) => ({
  state,
  long_missing: false,
  score,
  file,
  last_search,
})

export const episode = (id: number, season: number, number: number, name: string, over: Partial<Episode> = {}): Episode => ({
  id,
  season,
  number,
  name,
  primary_name: name,
  original_name: name,
  air_date: '2008-01-20',
  monitored: season > 0,
  cells: { standard: cell(season > 0 ? 'wanted' : 'unmonitored'), '4k': cell(season > 0 ? 'wanted' : 'unmonitored') },
  placeholder: false,
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
    newSeasons: true,
    specials: false,
    episodes: [
      episode(1, 0, 1, 'Good Cop Bad Cop'),
      episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120), '4k': cell('wanted') } }),
      episode(3, 1, 2, "Cat's in the Bag...", { air_date: null, cells: { standard: cell('unreleased'), '4k': cell('unreleased') } }),
    ],
    sent: [] as Sent[],
  }
  const seasons = () => [0, 1].map((n) => ({ number: n, monitored: state.episodes.some((e) => e.season === n && e.monitored) }))
  server.use(
    http.get('/titles/{id}', ({ response }) =>
      response(200).json(
        detail(r, { kind: 'series', tvdb_id: 81189, series_status: 'ended', series_monitor: state.mode, monitor_new_seasons: state.newSeasons, monitor_specials: state.specials, seasons: seasons() }),
      ),
    ),
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
      if (body.monitor_new_seasons !== undefined) state.newSeasons = body.monitor_new_seasons
      if (body.monitor_specials !== undefined) state.specials = body.monitor_specials
      return response(200).json(detail(r, { kind: 'series', series_monitor: state.mode, monitor_new_seasons: state.newSeasons, monitor_specials: state.specials, seasons: seasons() }))
    }),
  )
  return { ...state, lib, get: () => state }
}

/** Shows just one season of a Series' Title page, by its name ("Season 1", "Specials"): closes the other open ones in the Seasons accordion and opens it. */
export async function pickSeason(name: string) {
  for (const open of screen.queryAllByRole('button', { name: /^(Season \d+|Specials):/, expanded: true })) {
    if (!new RegExp(`^${name}:`).test(open.getAttribute('aria-label') ?? '')) await userEvent.click(open)
  }
  const row = screen.getByRole('button', { name: new RegExp(`^${name}:`) })
  if (row.getAttribute('aria-expanded') !== 'true') await userEvent.click(row)
}

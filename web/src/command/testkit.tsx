// What the command menu's tests share: the App, the menu opened, TMDB's lookups and POST /titles served from fixtures.
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'
import { displayDefaults, noDisplayDeclared } from '../test/display'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type LookupResult, type Sent, type Suggestion } from '../test/library'
import { seriesRow } from '../test/series'
import { server } from '../test/server'
import type { components } from '../api/schema.gen'

export const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

export const result = (id: number, title: string, over: Partial<LookupResult> = {}): LookupResult => ({
  kind: 'movie',
  tmdb_id: id,
  tvdb_id: null,
  title,
  year: 2014,
  poster: null,
  in_library: null,
  addable: true,
  not_addable_reason: null,
  network: null,
  origin_country: null,
  seasons: null,
  runtime: null,
  ratings: [],
  ...over,
})

const tmdb = (value: number, votes: number) => ({ source: 'tmdb', value, scale: 10, votes, url: null })

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  kind: 'movie',
  tmdb_id: 116149,
  title: 'Paddington',
  year: 2014,
  overview: 'A bear travels to London.',
  in_library: null,
  certification: '6',
  certification_country: 'DE',
  slots: [{ slot: 'standard', profile: 'hd-primary', label: 'HD', reason: 'default' }],
  ratings: [],
  poster: 'https://image.tmdb.org/t/p/w185/pad.jpg',
  runtime: 95,
  genres: [],
  ...over,
})

/** Breaking Bad as the search lists it, with what tells it apart. */
const breakingBad = result(1396, 'Breaking Bad', { kind: 'series', tvdb_id: 81189, year: 2008, network: 'AMC', origin_country: 'US', seasons: 5, ratings: [tmdb(8.9, 14523)] })

/** Its overview from TheTVDB: season 2 aired last, season 3 is announced. */
const breakingBadOverview: components['schemas']['LookupSeries'] = {
  status: 'ended',
  network: 'AMC',
  first_aired: '2008-01-20',
  last_aired: '2009-03-15',
  latest_season: 2,
  seasons: [
    { number: 0, episodes: 1, first_aired: '2009-02-17', last_aired: '2009-02-17' },
    { number: 1, episodes: 3, first_aired: '2008-01-20', last_aired: '2008-02-10' },
    { number: 2, episodes: 3, first_aired: '2009-03-08', last_aired: '2010-06-13' },
    { number: 3, episodes: 1, first_aired: null, last_aired: null },
  ],
}

/**
 * TMDB as the menu sees it: Paddington (a Movie, addable), Paddington Returns (a Movie already in the Library) and Breaking Bad
 * (a Series), the details a Title page loads, and POST /titles, whose bodies are kept in `sent`. `overview` answers once it
 * resolves: at once by default, 'down' for TheTVDB failing. `create` can answer POST /titles with a problem.
 */
export function fakeTmdb({ overview = Promise.resolve<'ok' | 'down'>('ok'), create }: { overview?: Promise<'ok' | 'down'>; create?: () => { status: 422 | 500; body: unknown } } = {}) {
  const lib = fakeLibrary([row(7, 'Paddington Returns', 'Paddington 2')])
  const sent: Sent[] = []
  const queries: string[] = []
  server.use(
    http.get('/lookup', ({ request, response }) => {
      queries.push(new URL(request.url).searchParams.get('q') ?? '')
      return response(200).json({
        items: [
          result(116149, 'Paddington', { network: 'Heyday Films', origin_country: 'GB', runtime: 95, ratings: [tmdb(7.3, 4912)] }),
          result(346648, 'Paddington Returns', { in_library: 7 }),
          breakingBad,
        ],
        next_cursor: null,
        did_you_mean: null,
      })
    }),
    http.get('/lookup/{kind}/{tmdb_id}', ({ params, response }) =>
      response(200).json(
        params.kind === 'series' ? suggestion({ kind: 'series', tmdb_id: 1396, title: 'Breaking Bad', year: 2008, overview: 'A teacher turns to crime.', runtime: 47 }) : suggestion(),
      ),
    ),
    http.get('/lookup/series/{tmdb_id}/overview', async ({ response }) => {
      if ((await overview) === 'down') {
        return response(502).json({ type: 'about:blank', title: 'bad gateway', status: 502, detail: 'TheTVDB could not be reached', code: 'upstream_unavailable' })
      }
      return response(200).json(breakingBadOverview)
    }),
    http.post('/titles', async ({ request, response }) => {
      const body = (await request.json()) as { kind: string }
      sent.push({ path: 'titles', body })
      const failed = create?.()
      if (failed) return response('default').json(failed.body as never, { status: failed.status })
      const added = body.kind === 'series' ? seriesRow(8, 'Breaking Bad') : row(8, 'Paddington', 'Ein Bär namens Paddington')
      lib.rows = [added, ...lib.rows]
      return response(201).json(detail(added))
    }),
  )
  return { sent, queries }
}

export const openMenu = async () => {
  await screen.findByRole('navigation')
  await userEvent.keyboard('{Control>}k{/Control}')
  return screen.findByRole('dialog', { name: /command menu/i })
}

/** GET /settings with these root folders for Movies (Series keep /data/tv). */
export function settingsWithRoots(movies: string[]) {
  server.use(
    http.get('/settings', ({ response }) =>
      response(200).json({
        language_region: { primary_language: 'en', release_date_country: 'US' },
        check_github_updates: true,
        pause_grabs: false,
        display: displayDefaults,
        from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
        trash: { auto_update: true },
        metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        root_folders: { movies, series: ['/data/tv'] },
      }),
    ),
  )
}

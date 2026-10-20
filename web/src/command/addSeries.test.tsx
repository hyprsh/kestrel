import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { detail, fakeLibrary, type LookupResult, type Sent, type Suggestion } from '../test/library'
import { seriesRow } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const poster = 'https://image.tmdb.org/t/p/w92/bb.jpg'

const result = (over: Partial<LookupResult> = {}): LookupResult => ({
  kind: 'series',
  tmdb_id: 1396,
  tvdb_id: 81189,
  title: 'Breaking Bad',
  year: 2008,
  poster,
  in_library: null,
  addable: true,
  not_addable_reason: null,
  ratings: [],
  ...over,
})

/** Breaking Bad as GET /lookup/series/1396 returns it. */
const breakingBad: Suggestion = {
  kind: 'series',
  tmdb_id: 1396,
  title: 'Breaking Bad',
  year: 2008,
  overview: 'A teacher turns to crime.',
  in_library: null,
  certification: 'TV-MA',
  certification_country: 'US',
  slots: [{ slot: 'standard', profile: 'hd-primary', label: 'HD', reason: 'default' }],
  ratings: [],
  poster: 'https://image.tmdb.org/t/p/w185/bb.jpg',
  runtime: 47,
  genres: ['Drama', 'Crime'],
}

/** Its overview from TheTVDB (GET /lookup/series/1396/overview): season 2 aired last, season 3 is announced. */
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
 * Serves the search, the lookup and POST /titles. The overview answers once
 * `overview` resolves: at once by default, `'down'` for TheTVDB failing.
 */
function fakeAdd(overview: Promise<'ok' | 'down'> = Promise.resolve('ok')) {
  const lib = fakeLibrary([])
  const sent: Sent[] = []
  server.use(
    http.get('/lookup', ({ response }) => response(200).json({ items: [result()], next_cursor: null })),
    http.get('/lookup/{kind}/{tmdb_id}', ({ response }) => response(200).json(breakingBad)),
    http.get('/lookup/series/{tmdb_id}/overview', async ({ response }) => {
      if ((await overview) === 'down') {
        return response(502).json({ type: 'about:blank', title: 'bad gateway', status: 502, detail: 'TheTVDB could not be reached', code: 'upstream_unavailable' })
      }
      return response(200).json(breakingBadOverview)
    }),
    http.post('/titles', async ({ request, response }) => {
      sent.push({ path: 'titles', body: await request.json() })
      const added = seriesRow(8, 'Breaking Bad')
      lib.rows = [added, ...lib.rows]
      return response(201).json(detail(added, { kind: 'series', series_monitor: 'none' }))
    }),
  )
  return { sent }
}

async function search() {
  await screen.findByRole('navigation')
  await userEvent.keyboard('{Control>}k{/Control}')
  const menu = await screen.findByRole('dialog', { name: /command menu/i })
  await userEvent.keyboard('break')
  await userEvent.click(await within(menu).findByRole('option', { name: /add "break"/i }))
  return menu
}

async function openPanel(overview?: Promise<'ok' | 'down'>) {
  const f = fakeAdd(overview)
  renderApp()
  const menu = await search()
  await userEvent.click(await within(menu).findByRole('option', { name: /breaking bad/i }))
  await within(menu).findByText(/Preselected/)
  if (!overview) await within(menu).findByRole('list', { name: 'Seasons' })
  return { ...f, menu }
}

async function addWith(menu: HTMLElement, preset: string) {
  await userEvent.selectOptions(within(menu).getByRole('combobox', { name: 'Monitor' }), preset)
}

describe('the add panel', () => {
  it('shows each search result with its poster', async () => {
    fakeAdd()
    renderApp()
    const menu = await search()
    const option = await within(menu).findByRole('option', { name: /breaking bad/i })
    expect(option.querySelector('img')).toHaveAttribute('src', poster)
  })

  it('describes the Title: poster, description, year, age rating, runtime and genres', async () => {
    const { menu } = await openPanel()
    expect(within(menu).getByRole('img', { name: 'Breaking Bad poster' })).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/bb.jpg')
    expect(within(menu).getByText('A teacher turns to crime.')).toBeInTheDocument()
    const facts = within(menu).getByText(/TV-MA/)
    expect(facts).toHaveTextContent('2008')
    expect(facts).toHaveTextContent('47 min')
    expect(facts).toHaveTextContent('Drama, Crime')
  })

  it('gives a Series overview: status, network, air dates and every season', async () => {
    const { menu } = await openPanel()
    const facts = within(menu).getByText(/AMC/)
    expect(facts).toHaveTextContent('Ended')
    expect(facts).toHaveTextContent('2008')
    expect(facts).toHaveTextContent('2009')
    const seasons = within(menu).getByRole('list', { name: 'Seasons' })
    const rows = within(seasons).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Specials.*1 episode.*2009/),
      expect.stringMatching(/Season 1.*3 episodes.*2008/),
      expect.stringMatching(/Season 2.*3 episodes.*2009–2010/),
      expect.stringMatching(/Season 3.*1 episode.*not aired/),
    ])
  })

  it('opens before TheTVDB answers, with the series overview loading on its own', async () => {
    let answer: (v: 'ok') => void = () => {}
    const { menu } = await openPanel(new Promise((resolve) => (answer = resolve)))
    expect(within(menu).getByText('A teacher turns to crime.')).toBeInTheDocument()
    expect(within(menu).getByText('Loading the series overview…')).toBeInTheDocument()
    expect(within(menu).queryByRole('list', { name: 'Seasons' })).not.toBeInTheDocument()

    answer('ok')

    expect(await within(menu).findByRole('list', { name: 'Seasons' })).toBeInTheDocument()
    expect(within(menu).queryByText('Loading the series overview…')).not.toBeInTheDocument()
  })

  it('keeps adding working when the series overview fails', async () => {
    const { menu, sent } = await openPanel(Promise.resolve('down'))
    expect(await within(menu).findByText(/Could not load the series overview/)).toBeInTheDocument()
    expect(within(menu).getByText('A teacher turns to crime.')).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'all' })
  })

  it('adds only the first season, and nothing that comes later', async () => {
    const { menu, sent } = await openPanel()
    await addWith(menu, 'first')
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ kind: 'series', tmdb_id: 1396, versions: [{ slot: 'standard', profile: 'hd-primary' }], series_monitor: 'none', seasons: [1] })
  })

  it('adds the latest season that aired, and follows new seasons', async () => {
    const { menu, sent } = await openPanel()
    await addWith(menu, 'latest')
    expect(within(menu).getByRole('checkbox', { name: 'Season 2' })).toBeChecked()
    expect(within(menu).getByRole('checkbox', { name: 'Season 3' })).not.toBeChecked()
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'future', seasons: [2] })
  })

  it('adds the seasons picked, Specials included, with a toggle for new seasons', async () => {
    const { menu, sent } = await openPanel()
    await addWith(menu, 'pick')
    const specials = within(menu).getByRole('checkbox', { name: 'Specials' })
    expect(specials).not.toBeChecked()
    await userEvent.click(specials)
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Season 2' }))
    const follow = within(menu).getByRole('checkbox', { name: 'Follow new seasons' })
    expect(follow).toBeChecked()
    await userEvent.click(follow)
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'none', seasons: [0, 2] })
  })

  it('switches to picking when a season is ticked after a preset', async () => {
    const { menu, sent } = await openPanel()
    await addWith(menu, 'first')
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Season 3' }))
    expect(within(menu).getByRole('combobox', { name: 'Monitor' })).toHaveValue('pick')
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'none', seasons: [1, 3] })
  })
})

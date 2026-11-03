import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { detail, row } from '../test/library'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { cell, episode, fakeSeries, pickSeason, seriesRow } from '../test/series'
import { actionBar } from '../test/actionBar'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openSeries() {
  const state = fakeSeries()
  const view = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findAllByRole('rowgroup', { name: /episodes$/ })
  return { state, view }
}

const filled = { standard: cell('filled', 100), '4k': cell('filled', 100) }
/** The episode table of the open season, looked up afresh: the accordion draws a season's table when it opens. */
const episodeGrid = () => screen.getByRole('rowgroup', { name: /episodes$/ })
const params = () => new URLSearchParams(location.search)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the Seasons at a glance on the Title page', () => {
  it('has a row per season and Specials, first, with a cell per Version, and opens the latest season', async () => {
    const state = fakeSeries()
    state.get().episodes = [
      episode(1, 0, 1, 'Special'),
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 1, 2, 'Cat', { cells: filled }),
      episode(4, 2, 1, 'Seven Thirty-Seven', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
      episode(5, 2, 2, 'Grilled'),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })

    const region = screen.getByRole('region', { name: 'Versions' })
    expect(
      within(region)
        .getAllByRole('button', { name: /^(Season \d+|Specials):/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Specials: Not monitored', 'Season 1: Complete, Standard 2 of 2; 4K 2 of 2', 'Season 2: 2 Wanted, Standard 1 of 2, 1 Wanted; 4K 0 of 2, 2 Wanted'])
    // The first season with something Wanted is open; the others are closed.
    expect(
      within(region)
        .getAllByRole('button', { name: /^(Season \d+|Specials):/, expanded: true })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([expect.stringMatching(/^Season 2:/)])
    // One cell per Version: a quiet check when it has the whole season, else what it still needs, as a button.
    expect(within(region).getByRole('button', { name: 'Season 1, Standard: 2 of 2' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Season 1, 4K: 2 of 2' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Season 2, Standard: 1 Wanted' })).toHaveTextContent('1 Wanted')
    expect(within(region).getByRole('button', { name: 'Season 2, 4K: 2 Wanted' })).toHaveTextContent('2 Wanted')
    expect(within(region).getByRole('button', { name: 'Specials, Standard: Not monitored' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: /^Specials:/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('rowgroup', { name: 'Season 2 episodes' })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 2 episode 1' })).toBeInTheDocument()
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Select Season 1 episode 1' })).not.toBeInTheDocument()
  })

  it('shows the episodes of the season picked, and keeps the season in the address bar', async () => {
    await openSeries()
    expect(params().get('season')).toBeNull()

    await pickSeason('Specials')

    expect(screen.getByRole('button', { name: /^Specials:/, expanded: true })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 0 episode 1' })).toBeInTheDocument()
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Select Season 1 episode 1' })).not.toBeInTheDocument()
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?open=0'))
  })

  it('opens several seasons at once, and keeps them in the address', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: filled }), episode(3, 3, 1, 'Later', { cells: filled })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('button', { name: /^(Season \d+|Specials):/ })
    // Nothing is Wanted: the newest season opens.
    expect(screen.getByRole('button', { name: /^Season 3:/ })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^Season 1:/ }))
    expect(screen.getAllByRole('rowgroup', { name: /episodes$/ })).toHaveLength(2)
    await waitFor(() => expect(location.search).toBe('?open=1,3'))
    await userEvent.click(screen.getByRole('button', { name: /^Season 2:/ }))
    expect(screen.getAllByRole('rowgroup', { name: /episodes$/ })).toHaveLength(3)
    await waitFor(() => expect(location.search).toBe('?open=1,2,3'))
    await userEvent.click(screen.getByRole('button', { name: /^Season 3:/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Season 2:/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Season 1:/ }))
    expect(screen.queryByRole('rowgroup', { name: /episodes$/ })).not.toBeInTheDocument()
    await waitFor(() => expect(location.search).toBe('?open='))
  })

  describe('the seasons it opens by itself (seasons_open: latest_and_wanted)', () => {
    const wantedCells = { standard: cell('wanted'), '4k': cell('wanted') }
    async function openedSeasons(wantedIn: number | null) {
      const state = fakeSeries()
      state.get().episodes = [1, 2, 3, 4, 5].map((n) => episode(n, n, 1, `Episode ${n}`, { cells: n === wantedIn ? wantedCells : filled }))
      renderApp()
      await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
      await screen.findAllByRole('button', { name: /^Season \d+:/ })
      return screen.getAllByRole('button', { name: /^Season \d+:/, expanded: true }).map((b) => /^Season (\d+):/.exec(b.getAttribute('aria-label') ?? '')![1])
    }

    it('opens only the newest season when nothing is Wanted', async () => {
      expect(await openedSeasons(null)).toEqual(['5'])
    })

    it('opens a Wanted older season and the newest', async () => {
      expect(await openedSeasons(2)).toEqual(['2', '5'])
    })

    it('opens only the newest season when it is the one with something Wanted', async () => {
      expect(await openedSeasons(5)).toEqual(['5'])
    })
  })

  it('reads the open seasons from the address, and the old ?season= too', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: filled }), episode(3, 3, 1, 'Later', { cells: filled })]
    history.replaceState(null, '', '/library?open=2,3')
    const view = renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('button', { name: /^(Season \d+|Specials):/ })
    expect(screen.getAllByRole('button', { name: /^Season \d:/, expanded: true })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false')
    view.unmount()
    history.replaceState(null, '', '/library?season=1')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('button', { name: /^Season 1:/, expanded: true })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Season \d:/, expanded: true })).toHaveLength(1)
  })

  it('drops the season from the address when another Title is selected, a Movie included', async () => {
    const state = fakeSeries()
    const series = seriesRow(5, 'Breaking Bad')
    const movie = row(7, 'Heat', 'Heat')
    state.lib.rows = [series, movie]
    server.use(
      http.get('/titles/{id}', ({ params, response }) => response(200).json(Number(params.id) === 7 ? detail(movie) : detail(series, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' }))),
    )
    history.replaceState(null, '', '/library?season=0')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    await waitFor(() => expect(params().get('season')).toBe('0'))

    await userEvent.click(await screen.findByRole('option', { name: /heat/i }))

    await screen.findByRole('heading', { name: 'Heat' })
    await waitFor(() => expect(location.search).toBe(''))
  })

  it('opens the season the address names', async () => {
    history.replaceState(null, '', '/library?season=0')
    await openSeries()
    expect(screen.getByRole('button', { name: /^Specials:/, expanded: true })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 0 episode 1' })).toBeInTheDocument()
  })

  describe('the filter above the Seasons', () => {
    const wanted = { standard: cell('wanted'), '4k': cell('wanted') }
    const downloading = { standard: cell('downloading'), '4k': cell('wanted') }
    const unaired = { standard: cell('unreleased'), '4k': cell('unreleased') }
    /** S1: filled, wanted (2 episodes); S2: filled only; S3: downloading, not aired. Specials: unmonitored. */
    async function openFiltered(address = '/') {
      const state = fakeSeries(false)
      state.get().episodes = [
        episode(1, 0, 1, 'Special'),
        episode(2, 1, 1, 'Pilot', { cells: filled }),
        episode(3, 1, 2, 'Cat', { cells: wanted }),
        episode(4, 2, 1, 'Seven', { cells: filled }),
        episode(5, 3, 1, 'Grey Matter', { cells: downloading }),
        episode(6, 3, 2, 'Crazy Handful', { air_date: '2026-11-16', cells: unaired }),
      ]
      history.replaceState(null, '', address)
      const view = renderApp()
      await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
      await screen.findAllByRole('button', { name: /^(Season \d+|Specials):/ })
      return view
    }
    const tabs = () => screen.getByRole('tablist', { name: 'Show episodes' })
    const listed = () =>
      within(screen.getByRole('region', { name: 'Versions' }))
        .queryAllByRole('button', { name: /^(Season \d+|Specials):/ })
        .map((b) => b.getAttribute('aria-label')!.split(':')[0])
    const ticks = (season: number) =>
      within(screen.getByRole('rowgroup', { name: `Season ${season} episodes` }))
        .getAllByRole('checkbox', { name: /^Select Season/ })
        .map((c) => c.getAttribute('aria-label'))

    it('counts the whole Series: All, Wanted, Downloading and Not aired', async () => {
      await openFiltered()
      expect(
        within(tabs())
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['All 6', 'Wanted 2', 'Downloading 1', 'Not aired 1'])
      expect(within(tabs()).getByRole('tab', { selected: true })).toHaveTextContent('All')
      // One filter for the Series: no season has its own.
      expect(screen.getAllByRole('tablist', { name: /^Show/ })).toHaveLength(1)
    })

    it('starts with every season collapsed under the default setting', async () => {
      await openFiltered()
      expect(listed()).toEqual(['Specials', 'Season 1', 'Season 2', 'Season 3'])
      expect(screen.queryByRole('button', { name: /^(Season \d+|Specials):/, expanded: true })).not.toBeInTheDocument()
      expect(screen.queryByRole('rowgroup', { name: /episodes$/ })).not.toBeInTheDocument()
    })

    it('Wanted lists the seasons with something Wanted and shows only those episodes in the open ones', async () => {
      await openFiltered()
      await userEvent.click(screen.getByRole('button', { name: /^Season 1:/ }))
      expect(ticks(1)).toEqual(['Select Season 1 episode 1', 'Select Season 1 episode 2'])
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'Wanted 2' }))
      expect(listed()).toEqual(['Season 1', 'Season 3'])
      expect(ticks(1)).toEqual(['Select Season 1 episode 2'])
      // The row keeps counting the whole season.
      expect(screen.getByRole('button', { name: /^Season 1:/ }).getAttribute('aria-label')).toMatch(/Standard 1 of 2, 1 Wanted/)
    })

    it('Downloading lists the seasons with a download and Not aired those with an episode not out', async () => {
      await openFiltered()
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'Downloading 1' }))
      expect(listed()).toEqual(['Season 3'])
      await userEvent.click(screen.getByRole('button', { name: /^Season 3:/ }))
      expect(ticks(3)).toEqual(['Select Season 3 episode 1'])
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'Not aired 1' }))
      expect(listed()).toEqual(['Season 3'])
      expect(ticks(3)).toEqual(['Select Season 3 episode 2'])
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'All 6' }))
      expect(listed()).toEqual(['Specials', 'Season 1', 'Season 2', 'Season 3'])
      expect(screen.getByRole('button', { name: /^Season 3:/, expanded: true })).toBeInTheDocument() // seasons keep their state
    })

    it('says so under the filter when nothing matches', async () => {
      const state = fakeSeries(false)
      state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: filled })]
      renderApp()
      await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
      await screen.findAllByRole('button', { name: /^(Season \d+|Specials):/ })
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'Wanted 0' }))
      expect(listed()).toEqual([])
      expect(screen.getByText('No episodes match.')).toBeInTheDocument()
      expect(within(tabs()).getByRole('tab', { name: 'All 1' })).toBeInTheDocument()
    })

    it('is kept in the address and survives a reload', async () => {
      const view = await openFiltered()
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'Wanted 2' }))
      await waitFor(() => expect(params().get('show')).toBe('wanted'))
      view.unmount()
      await openFiltered(location.pathname + location.search)
      expect(within(tabs()).getByRole('tab', { selected: true })).toHaveTextContent('Wanted')
      expect(listed()).toEqual(['Season 1', 'Season 3'])
      await userEvent.click(within(tabs()).getByRole('tab', { name: 'All 6' }))
      await waitFor(() => expect(params().get('show')).toBeNull())
    })

    it('still opens the season a link names, and one with a found episode', async () => {
      await openFiltered('/library?open=2')
      expect(screen.getByRole('button', { name: /^Season 2:/, expanded: true })).toBeInTheDocument()
    })
  })

  it('folds the episodes not aired yet into one row that expands, and shows them under Not aired', async () => {
    const state = fakeSeries()
    const unaired = { standard: cell('unreleased'), '4k': cell('unreleased') }
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 1, 2, 'Cat', { air_date: '2026-11-02', cells: unaired }),
      episode(4, 1, 3, 'Grey Matter', { air_date: '2026-11-09', cells: unaired }),
      episode(5, 1, 4, 'Crazy Handful', { air_date: '2026-11-16', cells: unaired }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })

    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Select Season 1 episode 2' })).not.toBeInTheDocument()
    const fold = within(episodeGrid()).getByRole('button', { name: '3 more, not aired yet (S01E02 – S01E04, from Mon, Nov 2)' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Season 1 Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select All Episodes' }))
    expect(actionBar()).toBeInTheDocument() // only what shows is ticked
    await userEvent.click(screen.getByRole('button', { name: 'Clear Selection' }))

    await userEvent.click(fold)
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 1 episode 4' })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('row', { name: /Cat/ })).toHaveTextContent('Nov 2')
    await userEvent.click(within(episodeGrid()).getByRole('button', { name: 'Hide the Episodes Not Aired Yet' }))
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Select Season 1 episode 4' })).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('tablist', { name: 'Show episodes' })).getByRole('tab', { name: 'Not aired 3' }))
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 1 episode 4' })).toBeInTheDocument()
    expect(within(episodeGrid()).queryByRole('button', { name: /more, not aired yet/ })).not.toBeInTheDocument()
  })

  it('opens the folded row of an episode the address names', async () => {
    const state = fakeSeries()
    const unaired = { standard: cell('unreleased'), '4k': cell('unreleased') }
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 1, 2, 'Cat', { air_date: '2026-11-02', cells: unaired }),
      episode(4, 1, 3, 'Grey Matter', { air_date: '2026-11-09', cells: unaired }),
    ]
    history.replaceState(null, '', '/library?season=1&episode=3')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 1 episode 3' }).closest('[role=row]')).toHaveAttribute('aria-current', 'true')
  })

  it('has the season’s actions on its row, not in its body', async () => {
    const { state } = await openSeries()
    expect(state.get().sent).toEqual([])
    expect(screen.queryByRole('button', { name: 'Find an Episode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand All' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Table options' })).not.toBeInTheDocument()

    const body = screen.getByRole('rowgroup', { name: 'Season 1 episodes' })
    // The season's menu sits on its row beside its toggle, none nested in another button, and the body has no tools row.
    expect(within(body).queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Show episodes' })).toBeInTheDocument()
    expect(within(body).queryByRole('button', { name: 'Season 1 Actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search Season' })).not.toBeInTheDocument()
    const item = body.closest('[data-season]') as HTMLElement
    const toggle = within(item).getByRole('button', { name: /^Season 1:/ })
    const menuButton = within(item).getByRole('button', { name: 'Season 1 Actions' })
    expect(toggle).not.toContainElement(menuButton)
    await userEvent.click(menuButton)
    const menu = screen.getByRole('menu', { name: 'Season 1 Actions' })
    const items = [
      'Search All Wanted in Season 1',
      'Manual Search (Standard)…',
      'Manual Search (4K)…',
      'Select All Episodes',
      'Stop Monitoring Season 1',
      'Delete Standard Season’s Files…',
      'Delete 4K Season’s Files…',
    ]
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(items.map((t) => expect.stringContaining(t.replace('’', "'"))))
    await userEvent.keyboard('{Escape}')
  })

  it('disables Search All Wanted when nothing in the season is Wanted, and monitors a closed season from its menu without opening it', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: { standard: cell('wanted'), '4k': cell('wanted') } })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    const region = screen.getByRole('region', { name: 'Versions' })

    // Season 2 has what is Wanted, so it opened; Season 1 is closed.
    await userEvent.click(within(region).getByRole('button', { name: 'Season 2 Actions' }))
    expect(screen.getByRole('menuitem', { name: 'Search All Wanted in Season 2' })).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(region).getByRole('button', { name: 'Season 1 Actions' }))
    expect(screen.getByRole('menuitem', { name: /^Search All Wanted in Season 1/ })).toHaveAttribute('aria-disabled', 'true') // on the closed row too
    expect(within(region).getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop Monitoring Season 1' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
    expect(within(region).getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false') // acting on a row does not open it
  })

  it('searches only one Version from the menu of its season cell, and filters to what is Wanted', async () => {
    const state = fakeSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 1, 2, 'Cat', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }),
      episode(4, 1, 3, 'Bag', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
    ]
    const searched: { version: number; body: unknown }[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        const text = await request.text()
        searched.push({ version: Number(params.id), body: text ? JSON.parse(text) : null })
        return response(202).json({ search_id: 'search-1' })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    const region = screen.getByRole('region', { name: 'Versions' })

    await userEvent.click(within(region).getByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    const menu = screen.getByRole('menu', { name: 'Season 1, 4K: 2 Wanted' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([expect.stringContaining('Search Season 1 for 4K'), expect.stringContaining('Manual Search Season 1 (4K)…'), expect.stringContaining('Show the 2 Wanted Episodes')])
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Search Season 1 for 4K/ }))
    await waitFor(() => expect(searched).toHaveLength(1))
    expect(searched[0].version).toBe(52) // 4K only: Standard's cell is a check
    expect(searched[0].body).toEqual({ season: 1 })

    await userEvent.click(within(region).getByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Show the 2 Wanted Episodes/ }))
    await waitFor(() => expect(params().get('show')).toBe('wanted'))
    expect(within(screen.getByRole('tablist', { name: 'Show episodes' })).getByRole('tab', { selected: true })).toHaveTextContent('Wanted')
    expect(screen.getByRole('button', { name: /^Season 1:/, expanded: true })).toBeInTheDocument()
  })

  it('monitors and unmonitors a whole season from its menu, which dims the row while off', async () => {
    const { state } = await openSeries()
    const region = screen.getByRole('region', { name: 'Versions' })
    const season = () => region.querySelector('[data-season="1"]') as HTMLElement
    expect(season()).toHaveAttribute('data-monitored', 'on')
    await userEvent.click(within(season()).getByRole('button', { name: 'Season 1 Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop Monitoring Season 1' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
    await waitFor(() => expect(season()).toHaveAttribute('data-monitored', 'off'))
    expect(within(region).getByRole('button', { name: /^Season 1: Not monitored/ })).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Specials Actions' }))
    expect(screen.getByRole('menuitem', { name: 'Monitor Specials' })).toBeInTheDocument() // Specials start off
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(season()).getByRole('button', { name: 'Season 1 Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Monitor Season 1' }))
    await waitFor(() => expect(state.get().sent[1]).toEqual({ path: 'seasons/1', body: { monitored: true } }))
  })

  it('lays a season out on one row: its name with the episode count and first year, then a cell per Version', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { air_date: '2024-03-01', cells: filled }), episode(2, 1, 2, 'Cat', { air_date: '2025-01-05', cells: filled })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    const row = screen.getByRole('button', { name: /^Season 1:/ }).closest('[role=row]') as HTMLElement
    expect(within(row).getByText('2 episodes \u00b7 2024\u20132025')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Season 1, Standard: 2 of 2' })).toBeInTheDocument() // a quiet check, no "Complete" text
    expect(within(row).getByRole('button', { name: 'Season 1, 4K: 2 of 2' })).toBeInTheDocument()
    expect(within(row).queryByText('Complete')).not.toBeInTheDocument()
  })

  it('says each Version’s state of a season in its own cell, a Wanted count over a downloading one, a ring for a season not out yet', async () => {
    const state = fakeSeries()
    const none = { standard: cell('unreleased'), '4k': cell('unreleased') }
    state.get().episodes = [
      episode(1, 1, 1, 'Both', { cells: filled }),
      episode(2, 1, 2, 'Some', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
      episode(3, 1, 3, 'All wanted', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }),
      episode(4, 1, 4, 'Moving', { cells: { standard: cell('wanted'), '4k': cell('downloading') } }),
      episode(5, 2, 1, 'Later', { air_date: '2999-01-01', cells: none }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    const row = screen.getByRole('button', { name: /^Season 1:/ }).closest('[role=row]') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Season 1, Standard: 2 Wanted' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Season 1, 4K: 2 Wanted' })).toBeInTheDocument() // Wanted shows over the one downloading
    expect(
      within(row)
        .getByRole('button', { name: /^Season 1:/ })
        .getAttribute('aria-label'),
    ).toMatch(/2 Wanted · 1 downloading/)
    const later = screen.getByRole('button', { name: /^Season 2:/ }).closest('[role=row]') as HTMLElement
    expect(within(later).getByRole('button', { name: 'Season 2, Standard: Not out yet' })).toBeInTheDocument()
  })

  it('counts a Long Missing episode once, in the season’s name', async () => {
    const state = fakeSeries()
    const long = { ...cell('wanted'), long_missing: true }
    state.get().episodes = [
      episode(1, 1, 1, 'Both', { cells: filled }),
      episode(2, 1, 2, 'Wanted', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }),
      episode(3, 1, 3, 'Long', { cells: { standard: long, '4k': long } }),
      episode(4, 1, 4, 'Long in one', { cells: { standard: cell('filled', 100), '4k': long } }),
      episode(5, 1, 5, 'Off', { monitored: false, cells: { standard: cell('unmonitored'), '4k': cell('unmonitored') } }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('rowgroup', { name: /episodes$/ })
    expect(screen.getByRole('button', { name: /^Season 1:/ }).getAttribute('aria-label')).toMatch(/^Season 1: 1 Wanted · 2 Long Missing · 1 not monitored/)
    // The episodes of the open season show Long Missing in their cells.
    expect(within(screen.getByRole('rowgroup', { name: 'Season 1 episodes' })).getAllByRole('button', { name: /: Long Missing$/ })).toHaveLength(3)
  })
})

describe('what a season says when some of its episodes are not monitored', () => {
  it('says how many are not monitored instead of Complete, and Not monitored when none is monitored', async () => {
    const state = fakeSeries()
    const off = { standard: cell('unmonitored'), '4k': cell('unmonitored') }
    state.get().episodes = [
      episode(1, 0, 1, 'S1', { monitored: true, cells: filled }),
      ...[2, 3, 4, 5, 6].map((n) => episode(n, 0, n, `S${n}`, { monitored: false, cells: off })),
      episode(10, 1, 1, 'Pilot', { cells: filled }),
      episode(11, 1, 2, 'Two', { cells: filled }),
      episode(20, 2, 1, 'Off A', { monitored: false, cells: off }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findAllByRole('button', { name: /^(Season \d+|Specials):/ })
    const toggle = async (name: RegExp) => (await screen.findByRole('button', { name })).getAttribute('aria-label')

    expect(await toggle(/^Specials:/)).toMatch(/^Specials: 5 not monitored/)
    expect(await toggle(/^Season 1:/)).toMatch(/^Season 1: Complete/)
    expect(await toggle(/^Season 2:/)).toBe('Season 2: Not monitored')
    // Some of Specials is monitored, so its menu stops monitoring; none of Season 2 is, so its menu starts it.
    await userEvent.click(screen.getByRole('button', { name: 'Specials Actions' }))
    expect(screen.getByRole('menuitem', { name: 'Stop Monitoring Specials' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Season 2 Actions' }))
    expect(screen.getByRole('menuitem', { name: 'Monitor Season 2' })).toBeInTheDocument()
  })
})

describe('A found episode', () => {
  it('opens on the episode the address names', async () => {
    history.replaceState(null, '', '/library?season=1&episode=2')
    await openSeries()
    await waitFor(() => expect(within(episodeGrid()).getByRole('checkbox', { name: 'Select Season 1 episode 2' }).closest('[role=row]')).toHaveAttribute('aria-current', 'true'))
  })
})

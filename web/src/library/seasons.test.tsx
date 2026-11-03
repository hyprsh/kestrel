import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { detail, row } from '../test/library'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { cell, episode, fakeSeries, pickSeason, seriesRow } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openSeries() {
  const state = fakeSeries()
  const view = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findByRole('grid', { name: 'Episodes' })
  return { state, view }
}

const filled = { standard: cell('filled', 100), '4k': cell('filled', 100) }
/** The episode table of the open season, looked up afresh: the accordion draws a season's table when it opens. */
const episodeGrid = () => screen.getByRole('grid', { name: 'Episodes' })
const params = () => new URLSearchParams(location.search)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the Seasons at a glance on the Title page', () => {
  it('has a row per season and Specials, first, with each Slot’s counts, and opens the latest season', async () => {
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
    await screen.findByRole('grid', { name: 'Episodes' })

    const region = screen.getByRole('region', { name: 'Seasons' })
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
    // One chip per Slot with its count, amber while Wanted.
    expect(within(region).getByTitle('Standard 1 of 2, 1 Wanted')).toHaveTextContent(/^STD\s*1\/2$/)
    expect(within(region).getByTitle('Standard 1 of 2, 1 Wanted')).toHaveAttribute('data-state', 'wanted')
    expect(within(region).getByTitle('4K 0 of 2, 2 Wanted')).toHaveTextContent(/^4K\s*0\/2$/)
    expect(within(region).getByTitle('Standard 2 of 2')).toHaveAttribute('data-state', 'filled')
    expect(within(region).getByRole('button', { name: /^Specials:/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('region', { name: 'Season 2 episodes' })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 2 episode 1' })).toBeInTheDocument()
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
  })

  it('shows the episodes of the season picked, and keeps the season in the address bar', async () => {
    await openSeries()
    expect(params().get('season')).toBeNull()

    await pickSeason('Specials')

    expect(screen.getByRole('button', { name: /^Specials:/, expanded: true })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?open=0'))
  })

  it('opens several seasons at once, keeps them in the address and compares with Expand all', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: filled }), episode(3, 3, 1, 'Later', { cells: filled })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('region', { name: 'Seasons' })
    // Nothing is Wanted: the newest season opens.
    expect(screen.getByRole('button', { name: /^Season 3:/ })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^Season 1:/ }))
    expect(screen.getAllByRole('grid', { name: 'Episodes' })).toHaveLength(2)
    await waitFor(() => expect(location.search).toBe('?open=1,3'))
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getAllByRole('grid', { name: 'Episodes' })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByRole('grid', { name: 'Episodes' })).not.toBeInTheDocument()
    await waitFor(() => expect(location.search).toBe('?open='))
  })

  describe('the seasons it opens by itself (seasons_open: latest_and_wanted)', () => {
    const wantedCells = { standard: cell('wanted'), '4k': cell('wanted') }
    async function openedSeasons(wantedIn: number | null) {
      const state = fakeSeries()
      state.get().episodes = [1, 2, 3, 4, 5].map((n) => episode(n, n, 1, `Episode ${n}`, { cells: n === wantedIn ? wantedCells : filled }))
      renderApp()
      await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
      await screen.findByRole('region', { name: 'Seasons' })
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
    await screen.findByRole('region', { name: 'Seasons' })
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
    await screen.findByRole('grid', { name: 'Episodes' })
    await waitFor(() => expect(params().get('season')).toBe('0'))

    await userEvent.click(await screen.findByRole('option', { name: /heat/i }))

    await screen.findByRole('heading', { name: 'Heat' })
    await waitFor(() => expect(location.search).toBe(''))
  })

  it('opens the season the address names', async () => {
    history.replaceState(null, '', '/library?season=0')
    await openSeries()
    expect(screen.getByRole('button', { name: /^Specials:/, expanded: true })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
  })

  it('counts the open season’s episodes in its filter: All, Wanted, Downloading and Not aired', async () => {
    const state = fakeSeries()
    const eps = state.get().episodes
    eps[1] = { ...eps[1], cells: { standard: cell('filled', 120), '4k': cell('filled', 120) } }
    eps.push(episode(4, 1, 3, 'Grey Matter', { cells: { standard: cell('downloading'), '4k': cell('wanted') } }))
    eps.push(episode(5, 1, 4, 'Crazy Handful', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })

    const tabs = screen.getByRole('tablist', { name: /^Show/ })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['All 4', 'Wanted 2', 'Downloading 1', 'Not aired 1'])
    expect(screen.getByTitle(/^Standard 1 of 3/)).toHaveTextContent('1/3')

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Wanted 2' }))
    expect(
      within(episodeGrid())
        .getAllByRole('checkbox', { name: /^Tick Season 1/ })
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Tick Season 1 episode 3', 'Tick Season 1 episode 4'])
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Not aired 1' }))
    expect(
      within(episodeGrid())
        .getAllByRole('checkbox', { name: /^Tick Season 1/ })
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Tick Season 1 episode 2'])

    // Another season starts on All again.
    await pickSeason('Specials')
    expect(within(screen.getByRole('tablist', { name: /^Show/ })).getByRole('tab', { selected: true })).toHaveTextContent('All 1')
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
    await screen.findByRole('grid', { name: 'Episodes' })

    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Tick Season 1 episode 2' })).not.toBeInTheDocument()
    const fold = within(episodeGrid()).getByRole('button', { name: '3 more, not aired yet (S01E02 – S01E04, from Mon, Nov 2)' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(within(episodeGrid()).getByRole('checkbox', { name: 'Tick all of Season 1' }))
    expect(screen.getByRole('toolbar', { name: 'S01E01 ticked' })).toBeInTheDocument() // only what shows is ticked
    await userEvent.click(screen.getByRole('button', { name: 'Clear ticks' }))

    await userEvent.click(fold)
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 1 episode 4' })).toBeInTheDocument()
    expect(within(episodeGrid()).getByRole('row', { name: /Cat/ })).toHaveTextContent('Nov 2')
    await userEvent.click(within(episodeGrid()).getByRole('button', { name: 'Hide the episodes not aired yet' }))
    expect(within(episodeGrid()).queryByRole('checkbox', { name: 'Tick Season 1 episode 4' })).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('tablist', { name: /^Show/ })).getByRole('tab', { name: 'Not aired 3' }))
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 1 episode 4' })).toBeInTheDocument()
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
    await screen.findByRole('grid', { name: 'Episodes' })
    expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 1 episode 3' }).closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  it('has Find an episode and Expand all by the heading, and the season’s tools in its open body', async () => {
    const { state } = await openSeries()
    expect(state.get().sent).toEqual([])
    expect(screen.getByRole('button', { name: 'Find an episode' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Table options' })).not.toBeInTheDocument()

    const body = screen.getByRole('region', { name: 'Season 1 episodes' })
    // The tools row: the filters, Search season and the season's menu, none nested in another button.
    expect(within(body).getByRole('tablist', { name: /^Show/ })).toBeInTheDocument()
    expect(within(body).getByRole('button', { name: 'Search season' })).toBeEnabled()
    await userEvent.click(within(body).getByRole('button', { name: 'Season 1 actions' }))
    const menu = screen.getByRole('menu', { name: 'Season 1 actions' })
    const items = ['Search Season', 'Manual Search Season Standard…', 'Manual Search Season 4K…', 'Delete Standard Season’s Files…', 'Delete 4K Season’s Files…']
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(items.map((t) => expect.stringContaining(t.replace('’', "'"))))
    await userEvent.keyboard('{Escape}')
  })

  it('disables Search season when nothing in the season is Wanted, and monitors a closed season from its bookmark without opening it', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: { standard: cell('wanted'), '4k': cell('wanted') } })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })
    const region = screen.getByRole('region', { name: 'Seasons' })

    // Season 2 has what is Wanted, so it opened; Season 1 is closed.
    expect(within(screen.getByRole('region', { name: 'Season 2 episodes' })).getByRole('button', { name: 'Search season' })).toBeEnabled()
    await userEvent.click(within(region).getByRole('button', { name: /^Season 1:/ }))
    expect(within(screen.getByRole('region', { name: 'Season 1 episodes' })).getByRole('button', { name: 'Search season' })).toBeDisabled()
    await userEvent.click(within(region).getByRole('button', { name: /^Season 1:/ }))
    await userEvent.click(within(region).getByRole('button', { name: 'Stop monitoring Season 1' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
    expect(within(region).getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false') // acting on a row does not open it
  })

  it('has an icon button, named for the episode, for a row’s Search', async () => {
    await openSeries()
    const row = within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')!
    expect(within(row).getByRole('button', { name: 'Search S01E01' }).textContent).toBe('')
  })

  it('monitors and unmonitors a whole season from the bookmark that starts its row, which is dimmed while off', async () => {
    const { state } = await openSeries()
    const region = screen.getByRole('region', { name: 'Seasons' })
    const stop = within(region).getByRole('button', { name: 'Stop monitoring Season 1' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    expect(stop.closest('[data-monitored]')).toHaveAttribute('data-monitored', 'on')
    await userEvent.click(stop)
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
    const start = await within(region).findByRole('button', { name: 'Monitor Season 1' })
    expect(start).toHaveAttribute('aria-pressed', 'false')
    expect(start.closest('[data-monitored]')).toHaveAttribute('data-monitored', 'off')
    expect(within(region).getByRole('button', { name: /^Season 1: Not monitored/ })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Monitor Specials' })).toBeInTheDocument() // Specials start off
    await userEvent.click(start)
    await waitFor(() => expect(state.get().sent[1]).toEqual({ path: 'seasons/1', body: { monitored: true } }))
  })

  it('lays a season out on one line: its name with the episode count and first year, the state, a bar and a chip per Slot', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { air_date: '2024-03-01', cells: filled }), episode(2, 1, 2, 'Cat', { air_date: '2025-01-05', cells: filled })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })
    const row = screen.getByRole('button', { name: /^Season 1:/ }).closest('[role=listitem]') as HTMLElement
    expect(within(row).getByText('2 episodes \u00b7 2024')).toBeInTheDocument()
    expect(within(row).getByText('Complete')).toBeInTheDocument()
    expect(within(row).getByTitle('Standard 2 of 2')).toHaveTextContent(/^STD\s*2\/2$/) // two Slots: a chip each, in place of a lone count
    expect(within(row).getByTitle('4K 2 of 2')).toBeInTheDocument()
  })

  it('draws one bar per season with its episodes by combined state over every Slot, and a line under it', async () => {
    const state = fakeSeries()
    const none = { standard: cell('unreleased'), '4k': cell('unreleased') }
    state.get().episodes = [
      episode(1, 1, 1, 'Both', { cells: filled }),
      episode(2, 1, 2, 'Some', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
      episode(3, 1, 3, 'All wanted', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }),
      episode(4, 1, 4, 'Moving', { cells: { standard: cell('wanted'), '4k': cell('downloading') } }),
      episode(5, 1, 5, 'Later', { air_date: '2999-01-01', cells: none }),
      episode(6, 1, 6, 'Off', { monitored: false, cells: { standard: cell('unmonitored'), '4k': cell('unmonitored') } }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })
    const row = screen.getByRole('button', { name: /^Season 1:/ }).closest('[role=listitem]')!
    expect(Array.from(row.querySelectorAll('[data-bar]')).map((q) => q.getAttribute('data-bar'))).toEqual(['filled', 'partial', 'downloading', 'unreleased', 'unmonitored'])
    // One bar, whatever the Slot count; the line under it says what is open.
    expect(row.querySelectorAll('[data-bar="partial"]')).toHaveLength(1)
    expect(within(row as HTMLElement).getByText('2 Wanted · 1 downloading · 1 not monitored')).toBeInTheDocument()
  })
})

describe('what a season says when some of its episodes are not monitored', () => {
  it('says how many are not monitored instead of Complete, and Not monitored with the grey bookmark when none is monitored', async () => {
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
    await screen.findByRole('region', { name: 'Seasons' })
    const row = (name: RegExp) => screen.getByRole('button', { name }).closest<HTMLElement>('[role=listitem]')!

    const specials = row(/^Specials:/)
    expect(within(specials).getByText('5 not monitored')).toBeInTheDocument()
    expect(within(specials).queryByText('Complete')).not.toBeInTheDocument()
    expect(within(specials).getByRole('button', { name: 'Stop monitoring Specials' })).toBeInTheDocument() // some of it is monitored
    expect(within(row(/^Season 1:/)).getByText('Complete')).toBeInTheDocument()
    const none = row(/^Season 2:/)
    expect(within(none).getByText('Not monitored')).toBeInTheDocument()
    expect(within(none).getByRole('button', { name: 'Monitor Season 2' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Find an episode', () => {
  const find = () => screen.getByRole('searchbox', { name: 'Find an episode' })
  /** The field, opened from the toolbar's Find button if it is not open yet. */
  const field = async () => {
    if (!screen.queryByRole('searchbox', { name: 'Find an episode' })) await userEvent.click(screen.getByRole('button', { name: 'Find an episode' }))
    return find()
  }

  it('takes a code in any spelling, opens the season and highlights the episode, keeping it in the address bar', async () => {
    await openSeries()
    const special = () => within(screen.getByRole('region', { name: 'Specials episodes' }))

    for (const code of ['s0e1', '0x01', 'S00E01']) {
      await userEvent.clear(await field())
      await userEvent.type(await field(), code)
      expect(screen.getByRole('button', { name: /^Specials:/, expanded: true })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Season 1:/, expanded: true })).toBeInTheDocument() // the season that was open stays
      const row = special().getByRole('checkbox', { name: 'Tick Season 0 episode 1' }).closest('tr')!
      expect(row).toHaveAttribute('aria-current', 'true')
    }
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?season=0&episode=1&open=0,1'))
  })

  it('finds part of a name and highlights only that episode', async () => {
    await openSeries()
    await userEvent.type(await field(), "cat's")
    const row = (name: string) =>
      within(screen.getByRole('region', { name: 'Season 1 episodes' }))
        .getByRole('checkbox', { name })
        .closest('tr')!
    expect(row('Tick Season 1 episode 2')).toHaveAttribute('aria-current', 'true')
    expect(row('Tick Season 1 episode 1')).not.toHaveAttribute('aria-current')
  })

  it('says when nothing matches, and clears the highlight when the field is cleared', async () => {
    await openSeries()
    await userEvent.type(await field(), 's1e1')
    const row = within(screen.getByRole('region', { name: 'Season 1 episodes' }))
      .getByRole('checkbox', { name: 'Tick Season 1 episode 1' })
      .closest('tr')!
    expect(row).toHaveAttribute('aria-current', 'true')

    await userEvent.clear(await field())
    expect(row).not.toHaveAttribute('aria-current')

    await userEvent.type(await field(), 's9e9')
    expect(screen.getByRole('status')).toHaveTextContent('No episode matches "s9e9".')
  })

  it('opens on the episode the address names', async () => {
    history.replaceState(null, '', '/library?season=1&episode=2')
    await openSeries()
    await waitFor(() => expect(within(episodeGrid()).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }).closest('tr')).toHaveAttribute('aria-current', 'true'))
    expect(find()).toHaveValue('S01E02')
  })
})

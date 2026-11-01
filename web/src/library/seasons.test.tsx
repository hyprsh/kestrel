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
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, view }
}

const filled = { standard: cell('filled', 100), '4k': cell('filled', 100) }
const params = () => new URLSearchParams(location.search)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the Seasons at a glance on the Title page', () => {
  it('has a row per season and Specials, last, with each Slot’s counts, and opens the latest season', async () => {
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
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    const region = screen.getByRole('region', { name: 'Seasons' })
    expect(
      within(region)
        .getAllByRole('button', { name: /^(Season \d+|Specials):/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Season 1: Standard 2 of 2; 4K 2 of 2', 'Season 2: Standard 1 of 2, 1 Wanted; 4K 0 of 2, 2 Wanted, open', 'Specials: Standard not monitored; 4K not monitored'])
    expect(within(region).getByRole('button', { name: /^Season 2:/ })).toHaveAttribute('aria-current', 'true')
    expect(within(region).getByRole('button', { name: /^Season 2:/ })).toHaveTextContent('0/2 · 2 Wanted')
    expect(within(region).getByRole('button', { name: /^Season 1:/ })).toHaveTextContent('2/2')
    expect(within(region).getByRole('button', { name: /^Specials:/ })).toHaveTextContent('not monitored')
    expect(within(region).getByText('Not monitored')).toBeInTheDocument() // the legend
    expect(screen.getByRole('heading', { name: 'Season 2' })).toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 2 episode 1' })).toBeInTheDocument()
    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
  })

  it('shows the episodes of the season picked, and keeps the season in the address bar', async () => {
    const { grid } = await openSeries()
    expect(params().get('season')).toBeNull()

    await pickSeason('Specials')

    expect(screen.getByRole('button', { name: /^Specials:.*, open$/ })).toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?season=0'))
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
    const { grid } = await openSeries()
    expect(screen.getByRole('button', { name: /^Specials:.*, open$/ })).toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
  })

  it('counts the open season’s episodes in its filter: All, Missing, Downloading and Not aired', async () => {
    const state = fakeSeries()
    const eps = state.get().episodes
    eps[1] = { ...eps[1], cells: { standard: cell('filled', 120), '4k': cell('filled', 120) } }
    eps.push(episode(4, 1, 3, 'Grey Matter', { cells: { standard: cell('downloading'), '4k': cell('wanted') } }))
    eps.push(episode(5, 1, 4, 'Crazy Handful', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    const tabs = screen.getByRole('tablist', { name: 'Show' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['All 4', 'Missing 2', 'Downloading 1', 'Not aired 1'])
    expect(screen.getByRole('button', { name: /^Season 1:/ })).toHaveTextContent('1/3')

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Missing 2' }))
    expect(
      within(grid)
        .getAllByRole('checkbox', { name: /^Tick Season 1/ })
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Tick Season 1 episode 3', 'Tick Season 1 episode 4'])
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Not aired 1' }))
    expect(
      within(grid)
        .getAllByRole('checkbox', { name: /^Tick Season 1/ })
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Tick Season 1 episode 2'])

    // Another season starts on All again.
    await pickSeason('Specials')
    expect(within(screen.getByRole('tablist', { name: 'Show' })).getByRole('tab', { selected: true })).toHaveTextContent('All 1')
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
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 2' })).not.toBeInTheDocument()
    const fold = within(grid).getByRole('button', { name: '3 more, not aired yet (S01E02 – S01E04, from Nov 2)' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick all of Season 1' }))
    expect(screen.getByRole('toolbar', { name: 'S01E01 ticked' })).toBeInTheDocument() // only what shows is ticked
    await userEvent.click(screen.getByRole('button', { name: 'Clear ticks' }))

    await userEvent.click(fold)
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 4' })).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 2 Standard: Unreleased' })).toHaveTextContent('Nov 2')
    await userEvent.click(within(grid).getByRole('button', { name: 'Hide the episodes not aired yet' }))
    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 4' })).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('tablist', { name: 'Show' })).getByRole('tab', { name: 'Not aired 3' }))
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 4' })).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: /more, not aired yet/ })).not.toBeInTheDocument()
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
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 3' }).closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  it('has Find an episode in the toolbar and the season’s actions on its row in the Seasons card', async () => {
    const { state } = await openSeries()
    expect(state.get().sent).toEqual([])
    expect(screen.getByRole('button', { name: 'Find an episode' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Table options' })).not.toBeInTheDocument()

    const region = screen.getByRole('region', { name: 'Seasons' })
    // The open-season button and the actions are siblings in the row, not nested buttons.
    const open = within(region).getByRole('button', { name: /^Season 1:/ })
    expect(open.querySelector('button')).toBeNull()
    expect(open.parentElement).toContainElement(within(region).getByRole('button', { name: 'Search Season 1' }))
    expect(within(region).getByRole('button', { name: 'Search Season 1' }).textContent).toBe('')

    await userEvent.click(within(region).getByRole('button', { name: 'Actions for Season 1' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Season 1' })
    const items = ['Search Season', 'Manual Search Season Standard…', 'Manual Search Season 4K…', 'Stop Monitoring Season', 'Delete Standard Season’s Files…', 'Delete 4K Season’s Files…']
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(items.map((t) => expect.stringContaining(t.replace('’', "'"))))
    expect(screen.queryByRole('menuitem', { name: 'Reset Columns' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  })

  it('acts on a season that is not the open one, and marks the row whose menu is open', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(1, 1, 1, 'Pilot', { cells: filled }), episode(2, 2, 1, 'Next', { cells: { standard: cell('wanted'), '4k': cell('wanted') } })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })
    const region = screen.getByRole('region', { name: 'Seasons' })

    expect(within(region).getByRole('button', { name: 'Search Season 1' })).toBeDisabled() // nothing in Season 1 is Wanted
    expect(within(region).getByRole('button', { name: 'Search Season 2' })).toBeEnabled()
    await userEvent.click(within(region).getByRole('button', { name: 'Actions for Season 1' }))
    expect(within(region).getByRole('button', { name: 'Actions for Season 1' }).closest('[data-menu-open]')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(region).getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop Monitoring Season' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
    expect(params().get('season')).toBeNull() // acting on a row does not open it
  })

  it('has an icon button, named for the episode, for a row’s Search', async () => {
    const { grid } = await openSeries()
    const row = within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')!
    expect(within(row).getByRole('button', { name: 'Search S01E01' }).textContent).toBe('')
  })

  it('offers Reset Columns in the toolbar’s table options only while the widths differ, and resets them', async () => {
    localStorage.setItem('kestrel.columns.episodes', JSON.stringify({ name: 300 }))
    await openSeries()

    await userEvent.click(screen.getByRole('button', { name: 'Table options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset Columns' }))

    expect(localStorage.getItem('kestrel.columns.episodes')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Table options' })).not.toBeInTheDocument()
  })

  it('monitors and unmonitors a whole season from its menu', async () => {
    const { state } = await openSeries()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop Monitoring Season' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
  })
})

describe('Find an episode', () => {
  const find = () => screen.getByRole('searchbox', { name: 'Find an episode' })
  /** The field, opened from the toolbar's Find button if it is not open yet. */
  const field = async () => {
    if (!screen.queryByRole('searchbox', { name: 'Find an episode' })) await userEvent.click(screen.getByRole('button', { name: 'Find an episode' }))
    return find()
  }

  it('takes a code in any spelling, switches to the season and highlights the episode, keeping it in the address bar', async () => {
    const { grid } = await openSeries()

    for (const code of ['s0e1', '0x01', 'S00E01']) {
      await pickSeason('Season 1')
      await userEvent.clear(await field())
      await userEvent.type(await field(), code)
      expect(screen.getByRole('button', { name: /^Specials:.*, open$/ })).toBeInTheDocument()
      const row = within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' }).closest('tr')!
      expect(row).toHaveAttribute('aria-current', 'true')
    }
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?season=0&episode=1'))
  })

  it('finds part of a name and highlights only that episode', async () => {
    const { grid } = await openSeries()
    await userEvent.type(await field(), "cat's")
    const row = (name: string) => within(grid).getByRole('checkbox', { name }).closest('tr')!
    expect(row('Tick Season 1 episode 2')).toHaveAttribute('aria-current', 'true')
    expect(row('Tick Season 1 episode 1')).not.toHaveAttribute('aria-current')
  })

  it('says when nothing matches, and clears the highlight when the field is cleared', async () => {
    const { grid } = await openSeries()
    await userEvent.type(await field(), 's1e1')
    const row = within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')!
    expect(row).toHaveAttribute('aria-current', 'true')

    await userEvent.clear(await field())
    expect(row).not.toHaveAttribute('aria-current')

    await userEvent.type(await field(), 's9e9')
    expect(screen.getByRole('status')).toHaveTextContent('No episode matches "s9e9".')
  })

  it('opens on the episode the address names', async () => {
    history.replaceState(null, '', '/library?season=1&episode=2')
    const { grid } = await openSeries()
    await waitFor(() => expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }).closest('tr')).toHaveAttribute('aria-current', 'true'))
    expect(find()).toHaveValue('S01E02')
  })
})

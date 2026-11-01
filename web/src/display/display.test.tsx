import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { serveDisplay } from '../test/serveDisplay'
import { episode, fakeSeries, pickSeason } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** A Series with Seasons 1 to 3 and Specials, two episodes in each of seasons 1 and 3, all aired. */
function fakeLongSeries() {
  const state = fakeSeries()
  state.episodes.splice(
    0,
    state.episodes.length,
    episode(1, 0, 1, 'Special'),
    episode(2, 1, 1, 'One A'),
    episode(3, 1, 2, 'One B'),
    episode(4, 2, 1, 'Two A'),
    episode(5, 3, 1, 'Three A'),
    episode(6, 3, 2, 'Three B'),
  )
  return state
}

async function openGrid() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('grid', { name: 'Episodes' })
}

/** The seasons in the Seasons at a glance, in order. */
const tabsOf = async () =>
  within(screen.getByRole('region', { name: 'Seasons' }))
    .getAllByRole('button', { name: /^(Season \d+|Specials):/ })
    .map((b) => b.getAttribute('aria-label')?.split(':')[0])
const rowsOf = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('checkbox', { name: /^Tick Season/ })
    .map((c) => c.getAttribute('aria-label')?.replace('Tick ', ''))

beforeEach(() => localStorage.clear())

describe('season order in the episode table', () => {
  it('lists Specials, then Season 1, 2 and 3 in the Seasons, opens the first with something Wanted, and the oldest episode first, by default', async () => {
    serveDisplay()
    fakeLongSeries()
    const grid = await openGrid()
    expect(await tabsOf()).toEqual(['Specials', 'Season 1', 'Season 2', 'Season 3'])
    expect(rowsOf(grid)).toEqual(['Season 1 episode 1', 'Season 1 episode 2']) // the first season with something Wanted is open
    await pickSeason('Season 3')
    expect(rowsOf(screen.getByRole('grid', { name: 'Episodes' }))).toEqual(['Season 3 episode 1', 'Season 3 episode 2'])
  })

  it('lists Season 3 first, then 2, 1 and Specials, with the newest episode first, with newest first', async () => {
    serveDisplay({ season_order: 'newest_first' })
    fakeLongSeries()
    const grid = await openGrid()
    expect(await tabsOf()).toEqual(['Season 3', 'Season 2', 'Season 1', 'Specials'])
    expect(rowsOf(grid)).toEqual(['Season 3 episode 2', 'Season 3 episode 1'])
  })

  it('moves with j and k in the order shown', async () => {
    serveDisplay({ season_order: 'newest_first' })
    fakeLongSeries()
    const grid = await openGrid()
    const row = (n: number) =>
      within(grid)
        .getByRole('checkbox', { name: `Tick Season 3 episode ${n}` })
        .closest('tr')!
    row(2).focus()
    await userEvent.keyboard('j')
    expect(row(1)).toHaveFocus()
    await userEvent.keyboard('k')
    expect(row(2)).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(row(1)).toHaveFocus()
  })
})

describe('Settings, Display', () => {
  async function openDisplay() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'General' }))
    return screen.findByRole('region', { name: 'Display' })
  }

  it('shows the three settings it offers at their defaults', async () => {
    serveDisplay()
    const section = await openDisplay()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('oldest_first')
    expect(within(section).queryByRole('combobox', { name: 'Seasons open by default' })).not.toBeInTheDocument()
    expect(within(section).getByRole('combobox', { name: 'Manual search sort' })).toHaveValue('best_first')
    expect(within(section).getByRole('combobox', { name: 'Upcoming shows' })).toHaveValue('all')
    expect(within(section).getByRole('switch', { name: 'Wanted only' })).not.toBeChecked()
    expect(within(section).getByRole('switch', { name: 'Hide imported' })).not.toBeChecked()
  })

  it('names each Manual search sort the way the Manual search Sort menu does', async () => {
    serveDisplay()
    const section = await openDisplay()
    const options = within(within(section).getByRole('combobox', { name: 'Manual search sort' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'Best first',
      'Worst first',
      'Release A to Z',
      'Release Z to A',
      'Quality A to Z',
      'Quality Z to A',
      'Languages A to Z',
      'Languages Z to A',
      'Custom formats: fewest points first',
      'Custom formats: most points first',
      'Smallest first',
      'Largest first',
      'Newest first',
      'Oldest first',
      'Indexer A to Z',
      'Indexer Z to A',
    ])
  })

  it('saves a change to the server, with nothing kept in the browser', async () => {
    const state = serveDisplay()
    const section = await openDisplay()
    await userEvent.selectOptions(within(section).getByRole('combobox', { name: 'Season order' }), 'newest_first')
    await userEvent.selectOptions(within(section).getByRole('combobox', { name: 'Manual search sort' }), 'size_desc')
    await userEvent.click(within(section).getByRole('switch', { name: 'Wanted only' }))
    expect(state.patched).toEqual([]) // a draft until saved
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(bar).toHaveTextContent('3 unsaved changes · Season order, Manual search sort, Wanted only')
    await userEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.patched).toHaveLength(1))
    expect(state.patched).toEqual([{ display: { season_order: 'newest_first', manual_search_sort: 'size_desc', upcoming_filters: { wanted_only: true } } }])
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument())
    await waitFor(() => expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('newest_first'))
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('saves Open the newest season and Upcoming starts on with the other Display settings', async () => {
    const state = serveDisplay()
    const section = await openDisplay()
    expect(within(section).getByRole('switch', { name: 'Open the newest season' })).toBeChecked()
    expect(within(section).getByRole('combobox', { name: 'Upcoming starts on' })).toHaveValue('agenda')
    await userEvent.click(within(section).getByRole('switch', { name: 'Open the newest season' }))
    await userEvent.selectOptions(within(section).getByRole('combobox', { name: 'Upcoming starts on' }), 'month')
    expect(state.patched).toEqual([]) // a draft until saved
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(bar).toHaveTextContent('2 unsaved changes · Open the newest season, Upcoming starts on')
    await userEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.patched).toEqual([{ display: { seasons_open: 'none', upcoming_display: 'month' } }]))
    await waitFor(() => expect(within(section).getByRole('switch', { name: 'Open the newest season' })).not.toBeChecked())
  })

  it('shows the switch off for any seasons_open but latest_and_wanted, and the new rows read-only when declared', async () => {
    serveDisplay({ seasons_open: 'all', upcoming_display: 'month' }, { seasons_open: true, upcoming_display: true })
    const section = await openDisplay()
    expect(within(section).getByRole('switch', { name: 'Open the newest season' })).not.toBeChecked()
    expect(within(section).getByRole('switch', { name: 'Open the newest season' })).toBeDisabled()
    expect(within(section).getByRole('combobox', { name: 'Upcoming starts on' })).toHaveValue('month')
    expect(within(section).getByRole('combobox', { name: 'Upcoming starts on' })).toBeDisabled()
    expect(within(section).getByText(/The Config File sets/)).toBeInTheDocument()
  })

  it('opens a Series on its first season with Open the newest season off', async () => {
    serveDisplay({ seasons_open: 'none' })
    fakeLongSeries()
    const grid = await openGrid()
    expect(rowsOf(grid)).toEqual(['Season 1 episode 1', 'Season 1 episode 2'])
  })

  it('opens the season a link names even with Open the newest season off', async () => {
    serveDisplay({ seasons_open: 'none' })
    fakeLongSeries()
    history.replaceState(null, '', '/library?season=2')
    const grid = await openGrid()
    expect(rowsOf(grid)).toEqual(['Season 2 episode 1'])
  })

  it('shows what the Config File declares as read-only and leaves the rest editable', async () => {
    serveDisplay({ season_order: 'newest_first' }, { season_order: true })
    const section = await openDisplay()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toBeDisabled()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('newest_first')
    expect(within(section).getByRole('combobox', { name: 'Manual search sort' })).toBeEnabled()
    expect(within(section).getByText(/The Config File sets/)).toBeInTheDocument()
  })
})

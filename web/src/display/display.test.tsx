import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { serveDisplay } from '../test/serveDisplay'
import { episode, fakeSeries } from '../test/series'

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

/** What the grid shows, in order: a season's name, or an episode's `season x number`. */
const rowsOf = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label')?.replace(' monitored', ''))

beforeEach(() => localStorage.clear())

describe('season order in the episode grid', () => {
  it('lists Season 1, 2, 3 and then Specials, oldest episode first, by default', async () => {
    serveDisplay()
    fakeLongSeries()
    const grid = await openGrid()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(rowsOf(grid)).toEqual([
      'Season 1',
      'Season 1 episode 1',
      'Season 1 episode 2',
      'Season 2',
      'Season 2 episode 1',
      'Season 3',
      'Season 3 episode 1',
      'Season 3 episode 2',
      'Specials',
      'Season 0 episode 1',
    ])
  })

  it('lists Season 3 with its newest episode first, then 2, 1 and Specials, with newest first', async () => {
    serveDisplay({ season_order: 'newest_first' })
    fakeLongSeries()
    const grid = await openGrid()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(rowsOf(grid)).toEqual([
      'Season 3',
      'Season 3 episode 2',
      'Season 3 episode 1',
      'Season 2',
      'Season 2 episode 1',
      'Season 1',
      'Season 1 episode 2',
      'Season 1 episode 1',
      'Specials',
      'Season 0 episode 1',
    ])
  })

  it('moves with j and k in the order shown', async () => {
    serveDisplay({ season_order: 'newest_first' })
    fakeLongSeries()
    const grid = await openGrid()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    within(grid).getByRole('checkbox', { name: 'Season 3' }).focus()
    await userEvent.keyboard('jj')
    expect(within(grid).getByRole('checkbox', { name: 'Season 3 episode 1 monitored' })).toHaveFocus()
    await userEvent.keyboard('j')
    expect(within(grid).getByRole('checkbox', { name: 'Season 2' })).toHaveFocus()
    await userEvent.keyboard('k')
    expect(within(grid).getByRole('checkbox', { name: 'Season 3 episode 1 monitored' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 0 episode 1 monitored' })).toHaveFocus()
  })
})

describe('which seasons open by default', () => {
  const openSeasons = (grid: HTMLElement) =>
    within(grid)
      .getAllByRole('button', { name: /^(Season \d|Specials) episodes$/ })
      .filter((b) => b.getAttribute('aria-expanded') === 'true')
      .map((b) => b.getAttribute('aria-label'))

  it('opens the latest season and those with Wanted episodes, never Specials, by default', async () => {
    serveDisplay()
    fakeLongSeries()
    expect(openSeasons(await openGrid())).toEqual(['Season 1 episodes', 'Season 2 episodes', 'Season 3 episodes']) // every episode is Wanted
  })

  it('opens every season with All, Specials too', async () => {
    serveDisplay({ seasons_open: 'all' })
    fakeLongSeries()
    expect(openSeasons(await openGrid())).toHaveLength(4)
  })

  it('opens no season with None', async () => {
    serveDisplay({ seasons_open: 'none' })
    fakeLongSeries()
    expect(openSeasons(await openGrid())).toEqual([])
  })

  it('lets a season the user toggled win over either mode', async () => {
    serveDisplay({ seasons_open: 'none' })
    fakeLongSeries()
    const first = await openGrid()
    await userEvent.click(within(first).getByRole('button', { name: 'Season 2 episodes' }))
    expect(openSeasons(first)).toEqual(['Season 2 episodes'])
    cleanup()

    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(openSeasons(await screen.findByRole('grid', { name: 'Episodes' }))).toEqual(['Season 2 episodes'])
  })
})

describe('Settings, Display', () => {
  async function openDisplay() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const heading = await screen.findByRole('heading', { name: 'Display', level: 2 })
    return heading.closest('section') as HTMLElement
  }

  it('shows the four settings at their defaults', async () => {
    serveDisplay()
    const section = await openDisplay()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('oldest_first')
    expect(within(section).getByRole('combobox', { name: 'Seasons open by default' })).toHaveValue('latest_and_wanted')
    expect(within(section).getByRole('combobox', { name: 'Manual search sort' })).toHaveValue('best_first')
    expect(within(section).getByRole('combobox', { name: 'Show' })).toHaveValue('all')
    expect(within(section).getByRole('checkbox', { name: 'Wanted only' })).not.toBeChecked()
    expect(within(section).getByRole('checkbox', { name: 'Hide imported' })).not.toBeChecked()
  })

  it('saves a change to the server, with nothing kept in the browser', async () => {
    const state = serveDisplay()
    const section = await openDisplay()
    await userEvent.selectOptions(within(section).getByRole('combobox', { name: 'Season order' }), 'newest_first')
    await userEvent.selectOptions(within(section).getByRole('combobox', { name: 'Manual search sort' }), 'size_desc')
    await userEvent.click(within(section).getByRole('checkbox', { name: 'Wanted only' }))
    await waitFor(() => expect(state.patched).toHaveLength(3))
    expect(state.patched).toEqual([{ display: { season_order: 'newest_first' } }, { display: { manual_search_sort: 'size_desc' } }, { display: { upcoming_filters: { wanted_only: true } } }])
    await waitFor(() => expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('newest_first'))
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('shows what the Config File declares as read-only and leaves the rest editable', async () => {
    serveDisplay({ season_order: 'newest_first' }, { season_order: true })
    const section = await openDisplay()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toBeDisabled()
    expect(within(section).getByRole('combobox', { name: 'Season order' })).toHaveValue('newest_first')
    expect(within(section).getByRole('combobox', { name: 'Seasons open by default' })).toBeEnabled()
    expect(within(section).getByText(/The Config File sets/)).toBeInTheDocument()
  })
})

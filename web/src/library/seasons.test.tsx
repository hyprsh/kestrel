import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { cell, episode, fakeSeries } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openSeries() {
  const state = fakeSeries()
  const view = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, view }
}

describe('collapsible seasons in the episode grid', () => {
  it('starts with Specials collapsed and the latest season, which has Wanted episodes, expanded', async () => {
    const { grid } = await openSeries()
    expect(within(grid).getByRole('button', { name: 'Specials episodes' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(grid).queryByRole('checkbox', { name: 'Season 0 episode 1 monitored' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Season 1 episodes' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1 episode 1 monitored' })).toBeInTheDocument()
  })

  it("hides and shows a season's episode rows without changing its monitoring", async () => {
    const { state, grid } = await openSeries()
    const season1 = within(grid).getByRole('button', { name: 'Season 1 episodes' })
    await userEvent.click(season1)
    expect(season1).toHaveAttribute('aria-expanded', 'false')
    expect(within(grid).queryByRole('checkbox', { name: 'Season 1 episode 1 monitored' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Season 1' })).toBeChecked()

    await userEvent.click(within(grid).getByRole('button', { name: 'Specials episodes' }))
    expect(within(grid).getByRole('checkbox', { name: 'Season 0 episode 1 monitored' })).toBeInTheDocument()

    await userEvent.click(season1)
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 2 Standard: Unreleased' })).toBeInTheDocument()
    expect(state.get().sent).toEqual([])
  })

  it('opens and closes seasons from the keyboard and skips the rows of closed seasons', async () => {
    const { state, grid } = await openSeries()
    await act(async () => (await screen.findByRole('button', { name: 'Collapse all' })).focus())
    await userEvent.tab() // the grid's one tab stop: the Specials header
    const specials = within(grid).getByRole('checkbox', { name: 'Specials' })
    expect(specials).toHaveFocus()

    // Specials are closed: Down goes straight to the next season's header.
    await userEvent.keyboard('{ArrowDown}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowRight}')
    expect(within(grid).getByRole('button', { name: 'Specials episodes' })).toHaveAttribute('aria-expanded', 'true')
    expect(specials).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 0 episode 1 monitored' })).toHaveFocus()

    // Left closes a season, Enter flips it; neither touches monitoring.
    await userEvent.keyboard('{ArrowDown}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(grid).getByRole('button', { name: 'Season 1 episodes' })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(within(grid).getByRole('button', { name: 'Season 1 episodes' })).toHaveAttribute('aria-expanded', 'true')
    expect(state.get().sent).toEqual([])

    // Space on a header still toggles the season's monitoring.
    await userEvent.keyboard(' ')
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
  })

  it('carries on from a season header after its toggle is clicked', async () => {
    const { grid } = await openSeries()
    await act(async () => (await screen.findByRole('button', { name: 'Collapse all' })).focus())
    await userEvent.tab()
    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1 episode 2 monitored' })).toHaveFocus()
    await userEvent.click(within(grid).getByRole('button', { name: 'Season 1 episodes' }))
    await userEvent.keyboard('{ArrowUp}')
    expect(within(grid).getByRole('checkbox', { name: 'Specials' })).toHaveFocus()
  })

  it("expands and collapses every season at once and keeps the grid's tab stop on a row still shown", async () => {
    const { grid } = await openSeries()
    await act(async () => (await screen.findByRole('button', { name: 'Collapse all' })).focus())
    await userEvent.tab()
    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('checkbox', { name: 'Season 1 episode 2 monitored' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    for (const name of ['Specials episodes', 'Season 1 episodes']) {
      expect(within(grid).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')
    }
    expect(within(grid).queryAllByRole('checkbox', { name: /episode/ })).toHaveLength(0)
    // The tab stop moved from the hidden episode to its season's header.
    await act(async () => screen.getByRole('button', { name: 'Collapse all' }).focus())
    await userEvent.tab()
    expect(within(grid).getByRole('checkbox', { name: 'Season 1' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(within(grid).getAllByRole('checkbox', { name: /episode/ })).toHaveLength(3)
  })

  it('remembers the seasons opened and closed for the Series when it comes back', async () => {
    const first = await openSeries()
    await userEvent.click(within(first.grid).getByRole('button', { name: 'Season 1 episodes' }))
    await userEvent.click(within(first.grid).getByRole('button', { name: 'Specials episodes' }))
    first.view.unmount()

    const { grid } = await openSeries()
    expect(within(grid).getByRole('button', { name: 'Season 1 episodes' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(grid).getByRole('button', { name: 'Specials episodes' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(grid).getByRole('checkbox', { name: 'Season 0 episode 1 monitored' })).toBeInTheDocument()
  })

  it('sums up a closed season per Slot: filled and Wanted episodes and the air years', async () => {
    const state = fakeSeries()
    const eps = state.get().episodes
    eps[1] = { ...eps[1], cells: { standard: cell('filled', 120), '4k': cell('wanted') } }
    eps.push(episode(4, 1, 3, '...And the Bag\'s in the River', { air_date: '2009-02-03' }))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    const header = (name: string) => within(grid).getByRole('checkbox', { name }).closest<HTMLElement>('[role="row"]')!
    expect(header('Specials')).toHaveTextContent('1 episode · 2008')
    expect(header('Specials')).toHaveTextContent('Standard 0/1 filled')
    // An open season shows its episodes instead.
    expect(header('Season 1')).not.toHaveTextContent('filled')

    await userEvent.click(within(grid).getByRole('button', { name: 'Season 1 episodes' }))
    expect(header('Season 1')).toHaveTextContent('3 episodes · 2008–2009')
    expect(header('Season 1')).toHaveTextContent('Standard 1/3 filled, 1 Wanted')
    expect(header('Season 1')).toHaveTextContent('4K 0/3 filled, 2 Wanted')
    expect(header('Season 1')).not.toHaveTextContent('downloading')
  })

  it('opens the latest season and any season with Wanted episodes, and closes the rest', async () => {
    const state = fakeSeries()
    const filled = { standard: cell('filled', 100), '4k': cell('filled', 100) }
    state.get().episodes = [
      episode(1, 0, 1, 'Special'),
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 2, 1, 'Seven Thirty-Seven'), // Wanted
      episode(4, 3, 1, 'No Mas', { cells: filled }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    const expanded = (name: string) => within(grid).getByRole('button', { name: `${name} episodes` }).getAttribute('aria-expanded')
    expect(['Specials', 'Season 1', 'Season 2', 'Season 3'].map(expanded)).toEqual(['false', 'false', 'true', 'true'])
  })
})

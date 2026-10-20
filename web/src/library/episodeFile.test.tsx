import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { cell, episode, fakeSeries } from '../test/series'

const pilotPath = '/media/tv/Breaking Bad (2008) {tvdb-81189}/Season 01/Breaking Bad (2008) - S01E01-E02 - [Standard][WEBDL-1080p].mkv'
const pilotFile = { id: 70, path: pilotPath, size: 2 * 1024 ** 3, quality: 'WEBDL-1080p', episode_ids: [2, 3] }

async function openSeries() {
  const state = fakeSeries()
  state.get().episodes = [
    episode(1, 0, 1, 'Good Cop Bad Cop'),
    episode(2, 1, 1, 'Pilot', { primary_name: 'Der Einstieg', cells: { standard: cell('filled', 120, pilotFile), '4k': cell('wanted') } }),
    episode(3, 1, 2, "Cat's in the Bag...", { cells: { standard: cell('filled', 120, pilotFile), '4k': cell('wanted') } }),
    episode(4, 1, 3, '', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }),
  ]
  const user = userEvent.setup()
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await user.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { user, grid }
}

const rowOf = (grid: HTMLElement, monitored: string) => within(grid).getByRole('checkbox', { name: `${monitored} monitored` }).closest<HTMLElement>('[role=row]')!

describe('episode titles', () => {
  it('shows the Primary-Language title with the original beneath only when they differ', async () => {
    const { grid } = await openSeries()
    const pilot = rowOf(grid, 'Season 1 episode 1')
    expect(within(pilot).getByText('Der Einstieg')).toBeInTheDocument()
    expect(within(pilot).getByText('Pilot')).toBeInTheDocument()

    const second = rowOf(grid, 'Season 1 episode 2')
    expect(within(second).getAllByText("Cat's in the Bag...")).toHaveLength(1)
  })

  it('shows a Placeholder Episode as TBA once, with no original title', async () => {
    const { grid } = await openSeries()
    const placeholder = rowOf(grid, 'Season 1 episode 3')
    expect(within(placeholder).getAllByText('TBA')).toHaveLength(1)
  })
})

describe('the file of an episode cell', () => {
  it('names the path, Score, quality and size in the tooltip', async () => {
    const { grid } = await openSeries()
    const tip = within(grid).getByRole('img', { name: 'Season 1 episode 1 Standard: Filled' }).getAttribute('title')
    expect(tip).toContain('Score 120')
    expect(tip).toContain('WEBDL-1080p')
    expect(tip).toContain('2.0 GB')
    expect(tip).toContain(pilotPath)
    expect(within(grid).getByRole('img', { name: 'Season 1 episode 3 Standard: Wanted' }).getAttribute('title')).toBe('Standard: Wanted')
  })

  it('opens a popover on click whose Copy button copies the path', async () => {
    const { user, grid } = await openSeries()
    await user.click(within(grid).getByRole('img', { name: 'Season 1 episode 1 Standard: Filled' }))

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    expect(within(pop).getByText(pilotPath)).toBeInTheDocument()
    expect(within(pop).getByText(/holds 2 episodes/)).toBeInTheDocument()
    await user.click(within(pop).getByRole('button', { name: 'Copy path' }))
    expect(await navigator.clipboard.readText()).toBe(pilotPath)
    expect(within(pop).getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Escape closed only the popover: the Series stays open.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('closes the popover on a click elsewhere and opens none for a cell without a file', async () => {
    const { user, grid } = await openSeries()
    await user.click(within(grid).getByRole('img', { name: 'Season 1 episode 2 Standard: Filled' }))
    expect(await screen.findByRole('dialog', { name: 'Season 1 episode 2 Standard file' })).toBeInTheDocument()

    await user.click(within(grid).getByRole('img', { name: 'Season 1 episode 3 Standard: Wanted' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

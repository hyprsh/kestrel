import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { cell, episode, episodeFile, fakeSeries, pickSeason } from '../test/series'

const pilotPath = '/media/tv/Breaking Bad (2008) {tvdb-81189}/Season 01/Breaking Bad (2008) - S01E01-E02 - [Standard][WEBDL-1080p].mkv'
const pilotFile = episodeFile({
  id: 70,
  path: pilotPath,
  size: 2 * 1024 ** 3,
  quality: 'WEBDL-1080p',
  video_codec: 'H.264',
  audio_codec: 'DD',
  audio_channels: '5.1',
  episode_ids: [2, 3],
  release_name: 'Breaking.Bad.S01E01-E02.1080p.WEB-DL.DD5.1.H.264-NTb',
  languages: ['English', 'German'],
  release_group: 'NTb',
  imported_at: '2020-10-20T12:00:00Z',
  custom_formats: [
    { name: 'WEB Tier 02', points: 1650 },
    { name: 'x265', points: -10 },
  ],
})

async function openSeries() {
  const state = fakeSeries()
  state.get().episodes = [
    episode(1, 0, 1, 'Good Cop Bad Cop'),
    episode(2, 1, 1, 'Pilot', { primary_name: 'Der Einstieg', cells: { standard: cell('filled', 120, pilotFile), '4k': cell('wanted') } }),
    episode(3, 1, 2, "Cat's in the Bag...", { cells: { standard: cell('filled', 120, pilotFile), '4k': cell('wanted') } }),
    episode(4, 1, 3, '', {
      air_date: null,
      placeholder: true,
      cells: {
        standard: cell('wanted'),
        '4k': cell('wanted', null, null, { at: new Date(Date.now() - 2 * 3_600_000).toISOString(), releases: 14, outcome: 'nothing_fit', reasons: [], upgrade: false }),
      },
    }),
    episode(5, 2, 1, '', { air_date: null }),
  ]
  const user = userEvent.setup()
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await user.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findAllByRole('rowgroup', { name: /episodes$/ })
  await pickSeason('Season 1') // Season 2, the latest, opens with Season 1, which has something Wanted
  const grid = screen.getByRole('rowgroup', { name: 'Season 1 episodes' })
  return { user, grid, state }
}

const rowOf = (grid: HTMLElement, episode: string) =>
  within(grid)
    .getByRole('checkbox', { name: `Select ${episode}` })
    .closest<HTMLElement>('[role=row]')!

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
    expect(within(placeholder).getByText('TBA')).toHaveAttribute('title', 'Not listed on TheTVDB yet')
    expect(within(placeholder).getByText('—')).toBeInTheDocument()
  })

  it('shows a listed episode without a title as TBA with no tooltip', async () => {
    await openSeries()
    await pickSeason('Season 2')
    expect(within(rowOf(screen.getByRole('rowgroup', { name: 'Season 2 episodes' }), 'Season 2 episode 1')).getByText('TBA')).not.toHaveAttribute('title')
  })
})

describe('the episodes loading Skeleton', () => {
  it('shows the table head and rows of Skeleton at once, announced once', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot')]
    server.use(
      http.get('/titles/{id}/episodes', async ({ response }) => {
        await delay(900)
        return response(200).json({ items: state.get().episodes })
      }),
    )
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const region = await screen.findByRole('region', { name: 'Seasons' })
    expect(within(region).getByText('Loading episodes')).toBeInTheDocument()
    expect(within(region).getByRole('table', { name: 'Seasons' })).toBeInTheDocument() // the Versions' head does not wait for the episodes
    expect(screen.queryByRole('rowgroup', { name: /episodes$/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })).toBeInTheDocument()
  })
})

/** One Version's cell of an episode (S01E01): a button whose menu or popover is that Version; `state` is "Have" or "Wanted". */
const cellOf = (grid: HTMLElement, code: string, slot: string, state = 'Have') => within(grid).getByRole('button', { name: `${code} ${slot}: ${state}` })

describe('the file of an episode Version, in the opened season', () => {
  it('names the Version and its state in its cell: a check button for a file, the state for a Wanted one', async () => {
    const { grid } = await openSeries()
    const row = rowOf(grid, 'Season 1 episode 1')
    expect(within(row).getByRole('button', { name: 'S01E01 Standard: Have' })).toHaveAttribute('title', 'Standard: Have')
    expect(within(row).getByRole('button', { name: 'S01E01 4K: Wanted' })).toBeInTheDocument()
    const placeholder = rowOf(grid, 'Season 1 episode 3')
    expect(within(placeholder).getByRole('button', { name: 'S01E03 Standard: Wanted' })).toBeInTheDocument()
  })

  it('opens the menu of a Wanted cell with Search and Manual Search for just that Version', async () => {
    const { user, grid } = await openSeries()
    await user.click(cellOf(grid, 'S01E03', '4K', 'Wanted'))
    expect(await screen.findByRole('menuitem', { name: 'Search S01E03 for 4K' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Manual Search S01E03 (4K)…' })).toBeInTheDocument()
  })

  it('opens a popover on click laid out like the mockup, whose Copy Path button copies the path', async () => {
    const { user, grid } = await openSeries()
    await user.click(cellOf(grid, 'S01E01', 'Standard'))

    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    expect(within(pop).getByText('S01E01 · Standard')).toBeInTheDocument()
    expect(within(pop).getByText('Breaking.Bad.S01E01-E02.1080p.WEB-DL.DD5.1.H.264-NTb')).toBeInTheDocument()
    // Each fact once: Quality is the quality alone, the codec is Video's, and the state is the dot's.
    expect(within(pop).getByText('Quality').nextSibling).toHaveTextContent(/^WEB-DL 1080p$/)
    expect(within(pop).getByText('Video').nextSibling).toHaveTextContent(/^H\.264 · SDR$/)
    expect(
      within(pop.parentElement!)
        .getAllByText(/H\.264/)
        .filter((e) => e.tagName === 'DD'),
    ).toHaveLength(1)
    expect(within(pop).getAllByText('2 GB')).toHaveLength(1)
    expect(within(pop).queryByText(/^Have$/)).not.toBeInTheDocument()
    expect(within(pop).getByText('DD 5.1 · English, German')).toBeInTheDocument()
    expect(within(pop).getByText('2 GB')).toBeInTheDocument()
    expect(within(pop).getByText('Oct 20, 2020')).toBeInTheDocument()
    expect(within(pop).getByText(/holds 2 episodes/)).toBeInTheDocument()
    // The path is one line that is cut at its start, with the whole of it as the tooltip.
    const path = within(pop).getByText(pilotPath)
    expect(path.closest('[dir="rtl"]')).toHaveAttribute('title', pilotPath)
    expect(within(pop).getByRole('button', { name: 'Upgrade Search' })).toBeInTheDocument()
    await user.click(within(pop).getByRole('button', { name: 'Copy Path' }))
    expect(await navigator.clipboard.readText()).toBe(pilotPath)
    expect(await within(pop).findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Escape closed only the popover: the Series stays open.
    expect(screen.getByRole('rowgroup', { name: 'Season 1 episodes' })).toBeInTheDocument()
  })

  it('shows the Score with each matched Custom Format and its signed points', async () => {
    const { user, grid } = await openSeries()
    await user.click(cellOf(grid, 'S01E01', 'Standard'))

    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    expect(within(pop).getByText('120')).toBeInTheDocument()
    const formats = within(within(pop).getByRole('list', { name: 'Custom Formats' })).getAllByRole('listitem')
    expect(formats.map((f) => f.textContent)).toEqual(['WEB Tier 02 +1,650', 'x265 \u221210', 'Profile and quality \u22121,520'])
  })

  it('leaves out the rows the file has no facts for, and the formats of a file that matched none', async () => {
    const state = fakeSeries()
    const bare = episodeFile({ id: 71, path: '/tv/S01E01.mkv', size: 1024 ** 3, quality: null, episode_ids: [2], release_name: '', imported_at: 'not a date' })
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', null, bare), '4k': cell('wanted') } })]
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })
    await pickSeason('Season 1')
    await user.click(cellOf(grid, 'S01E01', 'Standard'))

    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    expect(within(pop).getByText('Size')).toBeInTheDocument()
    for (const row of ['Quality', 'Audio', 'Imported', 'Score']) expect(within(pop).queryByText(row)).not.toBeInTheDocument()
    expect(within(pop).queryByRole('list', { name: 'Custom Formats' })).not.toBeInTheDocument()
    expect(within(pop).getByRole('button', { name: 'Copy Path' })).toBeInTheDocument()
  })

  it('shows the file name once: a release name that is the file name is left out', async () => {
    const state = fakeSeries()
    const same = episodeFile({ id: 73, path: '/tv/Show - S01E01.mkv', size: 1024 ** 3, quality: 'WEBDL-720p', episode_ids: [2], release_name: 'Show - S01E01' })
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 0, same), '4k': cell('wanted') } })]
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })
    await pickSeason('Season 1')
    await user.click(cellOf(grid, 'S01E01', 'Standard'))
    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    expect(within(pop).getAllByText(/Show - S01E01/)).toHaveLength(1)
  })

  it('shows a Score of a file that matched no Custom Format without a list of them', async () => {
    const state = fakeSeries()
    const plain = episodeFile({ id: 72, path: '/tv/S01E01.mkv', size: 1024 ** 3, quality: 'WEBDL-720p', episode_ids: [2] })
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 0, plain), '4k': cell('wanted') } })]
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })
    await pickSeason('Season 1')
    await user.click(cellOf(grid, 'S01E01', 'Standard'))

    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    expect(within(pop).getByText('Score')).toBeInTheDocument()
    expect(within(pop).queryByRole('list', { name: 'Custom Formats' })).not.toBeInTheDocument()
    // A file the parse knows no codec or audio format of says only its quality; nothing is invented.
    expect(within(pop).getByText('WEB-DL 720p')).toBeInTheDocument()
    expect(within(pop).queryByText('Audio')).not.toBeInTheDocument()
    expect(within(pop).queryByText('Video')).not.toBeInTheDocument()
  })

  it('opens the popover from the keyboard and tells the user to copy by hand when the clipboard and its fallback fail', async () => {
    const { user, grid } = await openSeries()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => false)
    cellOf(grid, 'S01E01', 'Standard').focus()
    await user.keyboard('{Enter}')

    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    await user.click(within(pop).getByRole('button', { name: 'Copy Path' }))
    expect((await within(pop).findAllByText(/copy it manually/)).length).toBeGreaterThan(0)
  })

  it('copies through the textarea fallback when the Clipboard API refuses', async () => {
    const { user, grid } = await openSeries()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => true)
    await user.click(cellOf(grid, 'S01E01', 'Standard'))
    const pop = await screen.findByRole('dialog', { name: 'S01E01 Standard file' })
    await user.click(within(pop).getByRole('button', { name: 'Copy Path' }))
    expect(await within(pop).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('closes the popover on a click elsewhere, and a Version popover is only that Version', async () => {
    const { user, grid } = await openSeries()
    await user.click(cellOf(grid, 'S01E02', 'Standard'))
    expect(await screen.findByRole('dialog', { name: 'S01E02 Standard file' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.click(within(grid).getByText('Der Einstieg'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

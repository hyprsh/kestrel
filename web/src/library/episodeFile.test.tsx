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
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  await pickSeason('Season 1') // Season 2, the latest, opens first
  return { user, grid, state }
}

const rowOf = (grid: HTMLElement, episode: string) =>
  within(grid)
    .getByRole('checkbox', { name: `Tick ${episode}` })
    .closest('tr')!

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
    const { grid } = await openSeries()
    await pickSeason('Season 2')
    expect(within(rowOf(grid, 'Season 2 episode 1')).getByText('TBA')).not.toHaveAttribute('title')
  })
})

describe('the episodes loading Skeleton', () => {
  it('shows the grid header and rows of Skeleton at once, announced once', async () => {
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
    const region = await screen.findByRole('region', { name: 'Episodes' })
    expect(within(region).getByText('Loading episodes')).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Episodes' })).not.toBeInTheDocument()
    expect(await screen.findByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })
})

describe('the file of an episode cell', () => {
  it('says the resolution and size of a filled cell on its one line, and what a Wanted one still lacks', async () => {
    const { grid } = await openSeries()
    const pilot = rowOf(grid, 'Season 1 episode 1')
    expect(within(pilot).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' })).toHaveTextContent('1080p · 2.0 GB')
    expect(within(pilot).getByRole('button', { name: 'Season 1 episode 1 4K: Wanted' })).toHaveTextContent(/^Wanted/)
  })

  it('names the path, Score, quality and size in the tooltip', async () => {
    const { grid } = await openSeries()
    const tip = within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }).getAttribute('title')
    expect(tip).toContain('Score 120')
    expect(tip).toContain('WEBDL-1080p')
    expect(tip).toContain('2.0 GB')
    expect(tip).toContain(pilotPath)
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 3 Standard: Wanted' }).getAttribute('title')).toBe('Standard: Wanted\nNot searched yet')
  })

  it('says in the tooltip of a Wanted cell when it was last searched, how many releases named it and how it ended', async () => {
    const { grid } = await openSeries()
    const tip = within(grid).getByRole('button', { name: 'Season 1 episode 3 4K: Wanted' }).getAttribute('title')
    expect(tip).toContain('Last searched 2 h ago · 14 releases · none fit the Profile')
  })

  it('opens a popover on click laid out like the mockup, whose Copy Path button copies the path', async () => {
    const { user, grid } = await openSeries()
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }))

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    expect(within(pop).getByText('S01E01 · Standard')).toBeInTheDocument()
    expect(within(pop).getByText('Breaking.Bad.S01E01-E02.1080p.WEB-DL.DD5.1.H.264-NTb')).toBeInTheDocument()
    expect(within(pop).getByText('WEB-DL 1080p · H.264')).toBeInTheDocument()
    expect(within(pop).getByText('DD 5.1 · English, German')).toBeInTheDocument()
    expect(within(pop).getByText('2.0 GB')).toBeInTheDocument()
    expect(within(pop).getByText('Oct 20, 2020, from NTb')).toBeInTheDocument()
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
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('shows the Score with each matched Custom Format and its signed points', async () => {
    const { user, grid } = await openSeries()
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }))

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    expect(within(pop).getByText('120')).toBeInTheDocument()
    const formats = within(within(pop).getByRole('list', { name: 'Custom Formats' })).getAllByRole('listitem')
    expect(formats.map((f) => f.textContent)).toEqual(['WEB Tier 02 +1650', 'x265 \u221210'])
  })

  it('leaves out the rows the file has no facts for, and the formats of a file that matched none', async () => {
    const state = fakeSeries()
    const bare = episodeFile({ id: 71, path: '/tv/S01E01.mkv', size: 1024 ** 3, quality: null, episode_ids: [2], release_name: '', imported_at: 'not a date' })
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', null, bare), '4k': cell('wanted') } })]
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    await pickSeason('Season 1')
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }))

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    expect(within(pop).getByText('Size')).toBeInTheDocument()
    for (const row of ['Quality', 'Audio', 'Imported', 'Score']) expect(within(pop).queryByText(row)).not.toBeInTheDocument()
    expect(within(pop).queryByRole('list', { name: 'Custom Formats' })).not.toBeInTheDocument()
    expect(within(pop).getByRole('button', { name: 'Copy Path' })).toBeInTheDocument()
  })

  it('shows a Score of a file that matched no Custom Format without a list of them', async () => {
    const state = fakeSeries()
    const plain = episodeFile({ id: 72, path: '/tv/S01E01.mkv', size: 1024 ** 3, quality: 'WEBDL-720p', episode_ids: [2] })
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 0, plain), '4k': cell('wanted') } })]
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    await pickSeason('Season 1')
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }))

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    expect(within(pop).getByText('Score')).toBeInTheDocument()
    expect(within(pop).queryByRole('list', { name: 'Custom Formats' })).not.toBeInTheDocument()
    // A file the parse knows no codec or audio format of says only its quality; nothing is invented.
    expect(within(pop).getByText('WEB-DL 720p')).toBeInTheDocument()
    expect(within(pop).queryByText('Audio')).not.toBeInTheDocument()
  })

  it('opens the popover from the keyboard and tells the user to copy by hand when the clipboard and its fallback fail', async () => {
    const { user, grid } = await openSeries()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => false)
    const cell = within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' })
    cell.focus()
    await user.keyboard('{Enter}')

    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    await user.click(within(pop).getByRole('button', { name: 'Copy Path' }))
    expect((await within(pop).findAllByText(/copy it manually/)).length).toBeGreaterThan(0)
  })

  it('copies through the textarea fallback when the Clipboard API refuses', async () => {
    const { user, grid } = await openSeries()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    document.execCommand = vi.fn(() => true)
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }))
    const pop = await screen.findByRole('dialog', { name: 'Season 1 episode 1 Standard file' })
    await user.click(within(pop).getByRole('button', { name: 'Copy Path' }))
    expect(await within(pop).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it("toggles the row's monitoring on Space and does not open the popover", async () => {
    const { user, grid, state } = await openSeries()
    within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }).focus()
    await user.keyboard(' ')
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2], monitored: false } }]))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the popover on a click elsewhere and opens none for a cell without a file', async () => {
    const { user, grid } = await openSeries()
    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 2 Standard: Filled' }))
    expect(await screen.findByRole('dialog', { name: 'Season 1 episode 2 Standard file' })).toBeInTheDocument()

    await user.click(within(grid).getByRole('button', { name: 'Season 1 episode 3 Standard: Wanted' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

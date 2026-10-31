import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { cell, episode, fakeSeries, pickSeason } from '../test/series'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { version: number; body: unknown }

const file = { id: 70, path: '/media/tv/Breaking Bad/Season 01/S01E01.mkv', size: 2 ** 30, quality: 'WEBDL-1080p', episode_ids: [2] }

/** Breaking Bad (Standard 51, 4K 52) with Search now and Manual search answered and recorded. */
async function openSeries() {
  const state = fakeSeries()
  const searched: Posted[] = []
  const manual: Posted[] = []
  const read = async (r: Request) => {
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
  server.use(
    http.post('/versions/{id}/search', async ({ params, request, response }) => {
      searched.push({ version: Number(params.id), body: await read(request) })
      return response(202).empty()
    }),
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      manual.push({ version: Number(params.id), body: await read(request) })
      return response(200).json({ items: [], indexer_errors: [] })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, searched, manual }
}

/** Picks `item` from the menu `menu`, a row's in the table or one outside it. */
async function choose(grid: HTMLElement | null, menu: string, item: string) {
  await userEvent.click((grid ? within(grid) : screen).getByRole('button', { name: menu }))
  await userEvent.click(screen.getByRole('menuitem', { name: item }))
}

describe('whose menu is open', () => {
  afterEach(() => localStorage.clear())

  it('marks the episode row while its menu is open, and moves the mark when another menu opens', async () => {
    const { grid } = await openSeries()
    const row = (name: string) => within(grid).getByRole('button', { name }).closest('tr')

    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 2' }))
    expect(row('Actions for Season 1 episode 2')).toHaveAttribute('data-menu-open')
    expect(row('Actions for Season 1 episode 1')).not.toHaveAttribute('data-menu-open')

    await userEvent.keyboard('{Escape}')
    expect(row('Actions for Season 1 episode 2')).not.toHaveAttribute('data-menu-open')

    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 1' }))
    expect(row('Actions for Season 1 episode 1')).toHaveAttribute('data-menu-open')
  })
})

describe('searching from the episode table', () => {
  afterEach(() => localStorage.clear())

  it('has Search and Manual… on every row, not hidden in a menu', async () => {
    const { grid } = await openSeries()
    for (const code of ['S01E01', 'S01E02']) {
      expect(within(grid).getByRole('button', { name: `Manual search ${code}` })).toBeVisible()
      expect(within(grid).getAllByRole('button', { name: new RegExp(`^(Search|Upgrade) ${code}$`) })).toHaveLength(1)
    }
  })

  it('searches one episode from its Search button, in each Slot that wants it', async () => {
    const { grid, searched } = await openSeries()

    await userEvent.click(within(grid).getByRole('button', { name: 'Search S01E01' }))

    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
    expect(await findToast('Search started for S01E01 in 4K')).toBeInTheDocument()
  })

  it('says in a Toast when the search of an episode could not start', async () => {
    const { grid } = await openSeries()
    server.use(
      http.post('/versions/{id}/search', ({ response }) =>
        response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'the indexer is down' }, { status: 500 }),
      ),
    )

    await userEvent.click(within(grid).getByRole('button', { name: 'Search S01E01' }))

    expect(await findToast('Could not search S01E01: the indexer is down')).toBeInTheDocument()
  })

  it('cannot search an episode nothing wants', async () => {
    const { grid } = await openSeries()
    expect(within(grid).getByRole('button', { name: 'Search S01E02' })).toBeDisabled()
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 2' }))
    expect(screen.getByRole('menuitem', { name: 'Search' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('opens Manual search for one episode in the Slot chosen from Manual…', async () => {
    const { grid, manual } = await openSeries()

    await userEvent.click(within(grid).getByRole('button', { name: 'Manual search S01E01' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '4K' }))

    const pane = await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
    expect(within(pane).getByText('S01E01')).toBeInTheDocument()
  })

  it('shows Upgrade on an episode with a file and nothing Wanted, and it opens Manual search on the Slot holding the file', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120, file), '4k': cell('unreleased') } })]
    const manual: Posted[] = []
    server.use(
      http.post('/versions/{id}/releases', async ({ params, request, response }) => {
        manual.push({ version: Number(params.id), body: await request.json() })
        return response(200).json({ items: [], indexer_errors: [] })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    expect(within(grid).queryByRole('button', { name: 'Search S01E01' })).not.toBeInTheDocument()

    await userEvent.click(within(grid).getByRole('button', { name: 'Upgrade S01E01' }))

    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1, episode_ids: [2] } }]))
  })

  it('searches the Wanted episodes of the season, and opens Manual search for it from the buttons above the table', async () => {
    const { searched, manual } = await openSeries()

    await userEvent.click(screen.getByRole('button', { name: 'Search season' }))
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1 } }]))

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manual search season… Standard' }))
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1 } }]))
    expect(within(await screen.findByRole('region', { name: 'Manual search' })).getByText('Season 1')).toBeInTheDocument()
  })

  it('ticks episodes, a range with shift-click, and searches them together from the floating bar', async () => {
    const { grid, searched } = await openSeries()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }))
    const bar = screen.getByRole('toolbar', { name: 'S01E01 ticked' })
    expect(bar).toHaveTextContent('1 ticked')
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }))
    await user.keyboard('{/Shift}')
    expect(screen.getByRole('toolbar', { name: '2 episodes ticked' })).toHaveTextContent('2 ticked')

    await userEvent.click(screen.getByRole('button', { name: 'Search Now' }))

    // Only the 4K pilot is Wanted among the two.
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { episode_ids: [2] } }]))
  })

  it('opens Manual search for the ticked episodes and unmonitors them from the bar', async () => {
    const { grid, manual, state } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }))
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }))

    await userEvent.click(screen.getByRole('button', { name: 'Unmonitor' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2, 3], monitored: false } }]))

    await userEvent.click(screen.getByRole('button', { name: 'Manual search 2 episodes' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Standard' }))
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1, episode_ids: [2, 3] } }]))
  })

  it('clears the ticks from the bar, and ticks every episode of the season from the header', async () => {
    const { grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick all of Season 1' }))
    expect(screen.getByRole('toolbar', { name: '2 episodes ticked' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear ticks' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeChecked()
  })

  it('drops the ticks of a season when another tab opens', async () => {
    const { grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }))
    expect(screen.getByRole('toolbar')).toBeInTheDocument()

    await pickSeason('Specials')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    await pickSeason('Season 1')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeChecked()
  })

  it('ticks from the row menu', async () => {
    const { grid } = await openSeries()
    await choose(grid, 'Actions for Season 1 episode 1', 'Tick')
    expect(screen.getByRole('toolbar', { name: 'S01E01 ticked' })).toBeInTheDocument()
  })

  it('opens a row menu from the keyboard and Escape closes it, back on the cell', async () => {
    const { grid } = await openSeries()
    const cell = within(grid).getByRole('button', { name: 'Season 1 episode 1 4K: Wanted' })
    cell.focus()

    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu', { name: 'Actions for Season 1 episode 1' })
    expect(within(menu).getByRole('menuitem', { name: 'Search' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(cell).toHaveFocus()
    // Escape stayed in the menu: the pane is still open.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('ticks the focused episode with x and Escape clears the ticks first', async () => {
    const { grid } = await openSeries()
    within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }).focus()

    await userEvent.keyboard('x')
    expect(screen.getByRole('toolbar', { name: 'S01E01 ticked' })).toBeInTheDocument()
    // The Library's own x (tick the Title, which swaps the pane for the bulk actions) did not fire.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('searches the episode under the cursor with s', async () => {
    const { grid, searched } = await openSeries()
    within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' }).focus()

    await userEvent.keyboard('s')

    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
  })

  it('opens Manual search for the episode under the cursor with m, in the Slot of its column', async () => {
    const { grid, manual } = await openSeries()
    within(grid).getByRole('button', { name: 'Season 1 episode 1 4K: Wanted' }).focus()

    await userEvent.keyboard('m')

    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
  })
})

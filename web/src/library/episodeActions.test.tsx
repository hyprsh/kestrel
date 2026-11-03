import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { cell, episode, episodeFile, fakeSeries, pickSeason } from '../test/series'
import { server } from '../test/server'
import { findToast, toastRegion } from '../test/toasts'
import { publishSearchFinished, type SearchFinished } from '../live/searchFinished'
import { releaseList } from '../test/grabs'
import { actionBar, queryActionBar, runQuiet } from '../test/actionBar'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { version: number; body: unknown }

const file = episodeFile({ id: 70, path: '/media/tv/Breaking Bad/Season 01/S01E01.mkv', size: 2 ** 30, quality: 'WEBDL-1080p', episode_ids: [2] })

/** Breaking Bad (Standard 51, 4K 52) with Search Now and Manual search answered and recorded. */
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
      return response(202).json({ search_id: 'search-1' })
    }),
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      manual.push({ version: Number(params.id), body: await read(request) })
      return response(200).json(releaseList())
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, searched, manual }
}

/** Picks `item` from the menu `menu`, an opened row's in the list or one outside it. */
async function choose(grid: HTMLElement | null, menu: string, item: string) {
  await userEvent.click((grid ? within(grid) : screen).getByRole('button', { name: menu }))
  await userEvent.click(screen.getByRole('menuitem', { name: item }))
}

/** One Slot's chip of an episode (S01E01), a button whose popover is that Slot. */
const chipOf = (grid: HTMLElement, code: string, slot: string) => within(within(grid).getByRole('group', { name: `${code} Slots` })).getByRole('button', { name: new RegExp(`^${slot}:`) })

const rowOf = (grid: HTMLElement, name: RegExp) => within(grid).getByRole('row', { name })

describe('the ⋯ menu of an episode', () => {
  afterEach(() => localStorage.clear())

  it('is on every row, and marks its row while it is open', async () => {
    const { grid } = await openSeries()
    expect(within(grid).getAllByRole('button', { name: /^Actions for Season 1 episode/ })).toHaveLength(2)
    const menu = within(grid).getByRole('button', { name: 'Actions for Season 1 episode 2' })
    await userEvent.click(menu)
    expect(menu.closest('tr')).toHaveAttribute('data-menu-open')
    await userEvent.keyboard('{Escape}')
    expect(menu.closest('tr')).not.toHaveAttribute('data-menu-open')
  })
})

describe('the Monitored toggle of an episode', () => {
  it('is a bookmark button on every row, named by the episode and its state, that flips one episode with a click', async () => {
    const { grid, state } = await openSeries()
    const on = within(grid).getByRole('button', { name: 'Stop Monitoring S01E01' })
    expect(on).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(on)

    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2], monitored: false } }]))
    const off = await within(grid).findByRole('button', { name: 'Monitor S01E01' })
    expect(off).toHaveAttribute('aria-pressed', 'false')
    expect(within(grid).getByRole('row', { name: /Pilot/ })).toHaveAttribute('data-monitored', 'off')
    expect(within(grid).getByRole('button', { name: 'Stop Monitoring S01E02' })).toHaveAttribute('aria-pressed', 'true') // the others stay
  })

  it('flips the episode from the keyboard with Enter and with Space', async () => {
    const { grid, state } = await openSeries()
    const row = within(grid).getByRole('row', { name: /Pilot/ })
    row.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(row).getByRole('button', { name: 'Stop Monitoring S01E01' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await within(grid).findByRole('button', { name: 'Monitor S01E01' })
    await userEvent.keyboard(' ')
    await within(grid).findByRole('button', { name: 'Stop Monitoring S01E01' })

    expect(state.get().sent.map((m) => (m.body as { monitored: boolean }).monitored)).toEqual([false, true])
    expect(within(grid).queryAllByRole('checkbox', { checked: true })).toHaveLength(0) // Space on the bookmark does not tick the row
  })
})

describe('searching from the episode list', () => {
  afterEach(() => localStorage.clear())

  it('has one Search button on every row, and Show in Log and Delete Files in its ⋯ menu', async () => {
    const { grid } = await openSeries()
    for (const code of ['S01E01', 'S01E02']) {
      expect(within(grid).getAllByRole('button', { name: new RegExp(`^Search ${code}$`) })).toHaveLength(1)
      expect(within(grid).queryByRole('button', { name: `Manual Search ${code}` })).not.toBeInTheDocument()
    }
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 1' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Season 1 episode 1' })
    const items = ['Show in Log', 'Delete Standard Files…', 'Delete 4K Files…']
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(items.map((t) => expect.stringContaining(t)))
  })

  it('opens the Log on the Series from an episode’s menu', async () => {
    const { grid } = await openSeries()
    await choose(grid, 'Actions for Season 1 episode 1', 'Show in Log')
    await waitFor(() => expect(location.pathname + location.search).toBe('/log?q=title%3A%22Breaking+Bad%22'))
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
    const search = within(grid).getByRole('button', { name: 'Search S01E02' })
    expect(search).toBeDisabled()
    // The tooltip says why.
    await userEvent.hover(search.closest('.hy-tooltip')!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Search S01E02: Nothing here is Wanted')
  })

  it('opens Manual search for one episode from the popover of its Wanted Slot', async () => {
    const { grid, manual } = await openSeries()

    await userEvent.click(chipOf(grid, 'S01E01', '4K'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'S01E01 4K' })).getByRole('button', { name: 'Manual Search' }))

    const pane = await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
    expect(within(pane).getByText('S01E01')).toBeInTheDocument()
  })

  it('runs an automatic Upgrade search from the popover of a cell with a file, in that Slot only, and keeps Manual search in the row menu', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120, file), '4k': cell('unreleased') } })]
    const manual: Posted[] = []
    const searched: Posted[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push({ version: Number(params.id), body: await request.json() })
        return response(202).json({ search_id: 'search-1' })
      }),
      http.post('/versions/{id}/releases', async ({ params, request, response }) => {
        manual.push({ version: Number(params.id), body: await request.json() })
        return response(200).json(releaseList())
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    expect(within(grid).getByRole('button', { name: 'Upgrade S01E01' })).toBeInTheDocument() // Search gives way to Upgrade when nothing is Wanted
    expect(within(grid).queryByRole('button', { name: 'Search S01E01' })).not.toBeInTheDocument()

    await userEvent.click(chipOf(grid, 'S01E01', 'Standard'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'S01E01 Standard file' })).getByRole('button', { name: 'Upgrade Search' }))

    await waitFor(() => expect(searched).toEqual([{ version: 51, body: { season: 1, episode_ids: [2], upgrade: true } }]))
    expect(await findToast('Upgrade search started for S01E01 in Standard')).toBeInTheDocument()
    expect(manual).toEqual([])

    await choose(grid, 'Actions for Season 1 episode 1', 'Manual Search…')
    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1, episode_ids: [2] } }]))
  })

  it('upgrades from the Upgrade button of the row, and says in a Toast when there is nothing to upgrade', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120, file), '4k': cell('unreleased') } })]
    const searched: Posted[] = []
    let answer = 202
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push({ version: Number(params.id), body: await request.json() })
        return answer === 200 ? response(200).empty() : response(202).json({ search_id: 'search-1' })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    await userEvent.click(within(grid).getByRole('button', { name: 'Upgrade S01E01' }))
    expect(await findToast('Upgrade search started for S01E01 in Standard')).toBeInTheDocument()

    answer = 200
    await userEvent.click(within(grid).getByRole('button', { name: 'Upgrade S01E01' }))
    expect(await findToast('Nothing to upgrade for S01E01 in Standard: it is at its Cutoff or already downloading')).toBeInTheDocument()
    expect(searched).toHaveLength(2)
  })

  it('searches the Wanted episodes of the season, and opens Manual search for it from the season menu', async () => {
    const { searched, manual } = await openSeries()

    await userEvent.click(within(screen.getByRole('button', { name: /^Season 1:/ }).closest('[role=listitem]') as HTMLElement).getByRole('button', { name: 'Search Season' })) // the season row's own button
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1 } }]))

    await choose(null, 'Season 1 Actions', 'Manual Search Season Standard…')
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1 } }]))
    expect(within(await screen.findByRole('region', { name: 'Manual search' })).getByText('Season 1')).toBeInTheDocument()
  })

  it('ticks episodes, a range with shift-click, and searches them together from the bar', async () => {
    const { grid, searched } = await openSeries()
    expect(queryActionBar()).not.toBeInTheDocument()

    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' }))
    const bar = actionBar()
    expect(bar).toHaveTextContent('1 selected')
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' }))
    await user.keyboard('{/Shift}')
    expect(actionBar()).toHaveTextContent('2 selected')

    await userEvent.click(within(actionBar()).getByRole('button', { name: 'Search' }))

    // Only the 4K pilot is Wanted among the two.
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { episode_ids: [2] } }]))
  })

  it('stops monitoring the ticked episodes from the bar, and opens Manual search for them from its menu', async () => {
    const { grid, manual, state } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' }))
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' }))

    const bar = actionBar()
    await runQuiet(bar, 'Stop Monitoring')
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2, 3], monitored: false } }]))

    await choose(null, 'More actions for the selected episodes', 'Manual Search Standard…')
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1, episode_ids: [2, 3] } }]))
  })

  it('shows the ticked bar as "N selected" with its clear ×, Search and a ⋯ menu, with Monitor and Stop Monitoring as its quiet actions that act on the ticked episodes', async () => {
    const { grid, state } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' }))
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' }))
    const bar = actionBar()
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent || b.getAttribute('aria-label')),
    ).toEqual(['Clear Selection', 'More Actions', 'Search', 'More actions for the selected episodes'])
    expect(bar).toHaveTextContent('2 selected')
    // Both are monitored already: Monitor has nothing to do.
    await userEvent.click(within(bar).getByRole('button', { name: 'More Actions' }))
    expect(screen.getByRole('menuitem', { name: 'Monitor' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')

    await runQuiet(bar, 'Stop Monitoring')
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2, 3], monitored: false } }]))
    await runQuiet(actionBar(), 'Monitor')
    await waitFor(() => expect(state.get().sent[1]).toEqual({ path: 'episodes/monitor', body: { episode_ids: [2, 3], monitored: true } }))
  })

  it('clears the ticks from the bar, and ticks every episode of the season from the header', async () => {
    const { grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select All of Season 1' }))
    expect(actionBar()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear Selection' }))
    expect(queryActionBar()).not.toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' })).not.toBeChecked()
  })

  it('drops the ticks of a season when another tab opens', async () => {
    const { grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' }))
    expect(actionBar()).toBeInTheDocument()

    await pickSeason('Specials')
    expect(queryActionBar()).not.toBeInTheDocument()
    await pickSeason('Season 1')
    expect(within(screen.getByRole('grid', { name: 'Episodes' })).getByRole('checkbox', { name: 'Select Season 1 episode 1' })).not.toBeChecked()
  })

  it('opens the menu of a row from the keyboard and Escape closes it', async () => {
    const { grid } = await openSeries()
    const row = rowOf(grid, /Pilot/)
    row.focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu', { name: 'Actions for Season 1 episode 1' })
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // Escape stayed in the menu: the pane is still open.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('ticks the focused episode with x and Escape clears the ticks first', async () => {
    const { grid } = await openSeries()
    rowOf(grid, /Pilot/).focus()

    await userEvent.keyboard('x')
    expect(actionBar()).toBeInTheDocument()
    // The Library's own x (tick the Title, which swaps the pane for the bulk actions) did not fire.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(queryActionBar()).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('searches the episode under the cursor with s', async () => {
    const { grid, searched } = await openSeries()
    rowOf(grid, /Pilot/).focus()

    await userEvent.keyboard('s')

    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
  })

  it('opens Manual search for the episode under the cursor with m, in its first Wanted Slot', async () => {
    const { grid, manual } = await openSeries()
    rowOf(grid, /Pilot/).focus()

    await userEvent.keyboard('m')

    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
  })
})

describe('the Toast at the end of a search started here', () => {
  afterEach(() => localStorage.clear())

  const finished = (over: Partial<SearchFinished>): SearchFinished => ({
    search_id: 'search-1',
    version_id: 51,
    title_id: 5,
    title: 'Breaking Bad',
    upgrade: true,
    outcome: 'none',
    grabbed: [],
    ...over,
  })

  async function openUpgrade() {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120, file), '4k': cell('unreleased') } })]
    server.use(http.post('/versions/{id}/search', ({ response }) => response(202).json({ search_id: 'search-1' })))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    await userEvent.click(within(grid).getByRole('button', { name: 'Upgrade S01E01' }))
    await findToast('Upgrade search started for S01E01 in Standard')
  }

  it('says No better Release found when an Upgrade search ended without a grab, with a link to Manual search', async () => {
    await openUpgrade()

    act(() => publishSearchFinished(finished({})))

    expect(await findToast('No better Release found for S01E01 in Standard')).toBeInTheDocument()
    await userEvent.click(within(await toastRegion()).getByRole('button', { name: 'Manual Search' }))
    expect(await screen.findByRole('region', { name: 'Manual search' })).toBeInTheDocument()
  })

  it('names the Release an Upgrade search grabbed, with a link to the Log', async () => {
    await openUpgrade()

    act(() => publishSearchFinished(finished({ outcome: 'grabbed', grabbed: ['Breaking.Bad.S01E01.2160p.BluRay-GRP'] })))

    expect(await findToast('Grabbed Breaking.Bad.S01E01.2160p.BluRay-GRP for S01E01 in Standard')).toBeInTheDocument()
    await userEvent.click(within(await toastRegion()).getByRole('button', { name: 'Open Log' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Log' })).toBeInTheDocument()
  })

  it('says a failed search failed, and ignores a search another tab started', async () => {
    await openUpgrade()

    act(() => publishSearchFinished(finished({ search_id: 'elsewhere', outcome: 'grabbed', grabbed: ['Other.Release'] })))
    act(() => publishSearchFinished(finished({ outcome: 'failed', error: 'No indexer is enabled' })))

    expect(await findToast('Search for S01E01 in Standard failed: No indexer is enabled')).toBeInTheDocument()
    expect(within(await toastRegion()).queryByText(/Other.Release/)).not.toBeInTheDocument()
  })

  it('says what a Search Now on a Wanted episode grabbed, or that it found nothing', async () => {
    const { grid } = await openSeries()

    await userEvent.click(within(grid).getByRole('button', { name: 'Search S01E01' }))
    await findToast('Search started for S01E01 in 4K')
    act(() => publishSearchFinished(finished({ version_id: 52, upgrade: false, outcome: 'grabbed', grabbed: ['Breaking.Bad.S01E01.1080p.WEB-DL-GRP'] })))

    expect(await findToast('Grabbed Breaking.Bad.S01E01.1080p.WEB-DL-GRP for S01E01 in 4K')).toBeInTheDocument()

    await userEvent.click(within(grid).getByRole('button', { name: 'Search S01E01' }))
    act(() => publishSearchFinished(finished({ search_id: 'search-1', version_id: 52, upgrade: false, outcome: 'none' })))

    expect(await findToast('No Release found to grab for S01E01 in 4K')).toBeInTheDocument()
  })
})

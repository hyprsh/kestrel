import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type LookupResult, type Sent } from '../test/library'
import { cell, episodeFile, fakeSeries, pickSeason, seriesRow } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const result = (id: number, title: string, over: Partial<LookupResult> = {}): LookupResult => ({
  kind: 'series',
  tmdb_id: id,
  tvdb_id: 1000 + id,
  title,
  year: 2008,
  poster: null,
  in_library: null,
  addable: true,
  not_addable_reason: null,
  network: null,
  origin_country: null,
  seasons: null,
  runtime: null,
  ratings: [],
  ...over,
})

function fakeSeriesLookup() {
  const lib = fakeLibrary([])
  const sent: Sent[] = []
  server.use(
    http.get('/lookup', ({ response }) =>
      response(200).json({
        items: [result(1396, 'Breaking Bad'), result(9001, 'Orphan Show', { tvdb_id: null, addable: false, not_addable_reason: 'not_on_tvdb' })],
        next_cursor: null,
        did_you_mean: null,
      }),
    ),
    http.get('/lookup/series/{tmdb_id}/overview', ({ response }) =>
      response(404).json({ type: 'about:blank', title: 'not found', status: 404, detail: 'This Series is not on TheTVDB', code: 'not_on_tvdb' }),
    ),
    http.get('/lookup/{kind}/{tmdb_id}', ({ params, response }) =>
      response(200).json({
        kind: 'series',
        tmdb_id: Number(params.tmdb_id),
        title: 'Breaking Bad',
        year: 2008,
        overview: '',
        in_library: null,
        certification: 'TV-MA',
        certification_country: 'US',
        slots: [{ slot: 'standard', profile: 'hd-primary', label: 'HD', reason: 'default' }],
        ratings: [],
        poster: null,
        runtime: null,
        genres: [],
      }),
    ),
    http.post('/titles', async ({ request, response }) => {
      const body = await request.json()
      sent.push({ path: 'titles', body })
      const added = seriesRow(8, 'Breaking Bad')
      lib.rows = [added, ...lib.rows]
      return response(201).json(detail(added, { kind: 'series', series_monitor: 'future' }))
    }),
  )
  return { sent }
}

async function searchBreaking() {
  await screen.findByRole('navigation')
  await userEvent.keyboard('{Control>}k{/Control}')
  const menu = await screen.findByRole('dialog', { name: /command menu/i })
  await userEvent.keyboard('break')
  return menu
}

describe('adding a Series from the command menu', () => {
  it('greys out a Series that is not on TheTVDB, says why and cannot add it', async () => {
    const f = fakeSeriesLookup()
    renderApp()
    const menu = await searchBreaking()

    const orphan = await within(menu).findByRole('option', { name: /orphan show/i })
    expect(orphan).toHaveAttribute('aria-disabled', 'true')
    expect(orphan).toHaveTextContent('Not on TheTVDB')
    await userEvent.click(orphan)
    expect(within(menu).queryByText(/^Add Orphan Show/)).not.toBeInTheDocument()
    expect(f.sent).toHaveLength(0)

    // The arrows skip it, so Enter cannot add it either: the highlight stays on the Series that can be added.
    await userEvent.keyboard('{ArrowDown}')
    expect(orphan).not.toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    expect(within(menu).queryByText(/^Add Orphan Show/)).not.toBeInTheDocument()
    expect(f.sent).toHaveLength(0)
  })

  it('adds a Series with a monitoring mode chosen in its page', async () => {
    const f = fakeSeriesLookup()
    renderApp()
    const menu = await searchBreaking()
    await userEvent.click(await within(menu).findByRole('option', { name: /breaking bad/i }))

    await userEvent.click(await within(menu).findByRole('option', { name: /^Monitor/ }))
    await userEvent.click(within(menu).getByRole('option', { name: /^Future Episodes Only/ })) // the overview is not there, so only the modes without seasons
    await userEvent.click(await within(menu).findByRole('option', { name: /^Add Series/ }))

    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({ kind: 'series', tmdb_id: 1396, versions: [{ slot: 'standard', profile: 'hd-primary' }], series_monitor: 'future' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

async function openSeries() {
  const state = fakeSeries()
  // The Pilot's Standard file, so its check opens the file's details.
  const pilot = state.get().episodes[1]
  pilot.cells = { ...pilot.cells, standard: cell('filled', 120, episodeFile({ id: 9, path: '/tv/Breaking Bad/S01E01.mkv', size: 2 << 30, quality: 'WEBDL-1080p', episode_ids: [2] })) }
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })
  return { state, grid }
}

describe('the episode list', () => {
  it('shows a row per episode of the open season and a cell per Version, its full state in the cell’s name', async () => {
    const { grid } = await openSeries()
    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    expect(within(pilot).getByRole('button', { name: 'S01E01 Standard: Have' })).toBeInTheDocument()
    expect(within(pilot).getByRole('button', { name: 'S01E01 4K: Wanted' })).toBeInTheDocument()
    const cat = within(grid).getByRole('row', { name: /Cat's in the Bag/ })
    expect(within(cat).getByRole('button', { name: 'S01E02 Standard: Not out yet' })).toBeInTheDocument()
    // The Versions are the columns of the table's head, not of the list.
    const table = screen.getByRole('table', { name: 'Seasons' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.getAttribute('aria-label')),
    ).toContain('Standard')
    expect(within(within(cat).getByRole('rowheader')).getByText('—')).toBeInTheDocument() // the second episode has no air date yet
    // Specials are another season, not rows of this list.
    expect(within(grid).queryByRole('row', { name: /Good Cop Bad Cop/ })).not.toBeInTheDocument()
    await pickSeason('Specials')
    const special = within(screen.getByRole('rowgroup', { name: 'Specials episodes' })).getByRole('row', { name: /Good Cop Bad Cop/ })
    expect(within(special).getByRole('button', { name: 'S00E01 Standard: Not monitored' })).toBeInTheDocument()
    expect(special).toHaveAttribute('data-monitored', 'off')
  })

  it('has an episode menu that monitors the episode or stops', async () => {
    const { state, grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('button', { name: 'S01E01 Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop Monitoring Episode' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2], monitored: false } }]))
    expect(await within(grid).findByRole('row', { name: /Pilot/ })).toHaveAttribute('data-monitored', 'off')
    await userEvent.click(within(grid).getByRole('button', { name: 'S01E01 Actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Monitor Episode' })).toBeInTheDocument()
  })

  it('opens the menu of just that Version from its cell: a click, or Enter on the focused cell', async () => {
    const { grid } = await openSeries()
    const cellOf = (code: string, slot: string) => within(grid).getByRole('button', { name: new RegExp(`^${code} ${slot}:`) })

    // A click on the row itself opens nothing.
    await userEvent.click(within(grid).getByText('Pilot'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(cellOf('S01E01', '4K'))
    const wanted = await screen.findByRole('menu', { name: 'S01E01 4K: Wanted' })
    expect(within(wanted).getByRole('menuitem', { name: 'Search S01E01 for 4K' })).toBeInTheDocument()
    expect(within(wanted).getByRole('menuitem', { name: 'Manual Search S01E01 (4K)…' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    // A filled cell opens the file's details.
    cellOf('S01E01', 'Standard').focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'S01E01 Standard file' })).toBeInTheDocument()
  })

  it('is operated from the keyboard: j/k and the arrows move rows, left and right move between cells, Space ticks, Enter opens a cell', async () => {
    const { grid } = await openSeries()
    // The controls above the list have their own tab stops: start at the last one before it.
    await act(async () => screen.getByRole('button', { name: 'Season 1 Actions' }).focus())
    await userEvent.tab() // the list's one tab stop: its first row
    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    expect(pilot).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    expect(within(pilot).getByRole('button', { name: /^S01E01 Standard:/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(pilot).getByRole('button', { name: /^S01E01 4K:/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(pilot).getByRole('button', { name: /^S01E01 4K:/ })).toHaveFocus() // the last cell stays
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menu', { name: 'S01E01 4K: Wanted' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(pilot).getByRole('button', { name: /^S01E01 Standard:/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(pilot).toHaveFocus()

    await userEvent.keyboard(' ')
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' })).toBeChecked()
    await userEvent.keyboard('{ArrowDown}')
    expect(within(grid).getByRole('row', { name: /Cat's in the Bag/ })).toHaveFocus()
    await userEvent.keyboard('x')
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' })).toBeChecked()
    await userEvent.keyboard('k')
    expect(pilot).toHaveFocus()
    // From a cell, j and k still move rows.
    await userEvent.keyboard('{ArrowRight}j')
    expect(within(grid).getByRole('row', { name: /Cat's in the Bag/ })).toHaveFocus()

    // The keys stayed inside the list: the Library selection did not move.
    expect(screen.getByRole('option', { name: /breaking bad/i, selected: true })).toBeInTheDocument()

    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('row', { name: /Cat's in the Bag/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(pilot).toHaveFocus()
  })

  it('changes the monitoring mode from the Monitored button of the header', async () => {
    const { state } = await openSeries()
    await userEvent.click(await screen.findByRole('button', { name: /^Monitoring: / }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^Not monitored/ }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'titles', body: { series_monitor: 'none' } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Monitoring: / })).toHaveTextContent('Not monitored'))
  })

  it('is not shown for a Movie', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('heading', { name: 'Heat' })
    expect(screen.queryByRole('rowgroup', { name: /episodes$/ })).not.toBeInTheDocument()
  })
})

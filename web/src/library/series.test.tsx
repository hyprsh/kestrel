import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type LookupResult, type Sent } from '../test/library'
import { fakeSeries, seriesRow } from '../test/series'
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
  await userEvent.click(await within(menu).findByRole('option', { name: /add "break"/i }))
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

  it('adds a Series with a monitoring mode chosen in the panel', async () => {
    const f = fakeSeriesLookup()
    renderApp()
    const menu = await searchBreaking()
    await userEvent.click(await within(menu).findByRole('option', { name: /breaking bad/i }))

    await within(menu).findByText(/Preselected/)
    expect(within(menu).getByRole('combobox', { name: 'Monitor' })).toHaveValue('all')
    await userEvent.selectOptions(within(menu).getByRole('combobox', { name: 'Monitor' }), 'future')
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))

    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({ kind: 'series', tmdb_id: 1396, versions: [{ slot: 'standard', profile: 'hd-primary' }], series_monitor: 'future' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

async function openSeries() {
  const state = fakeSeries()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid }
}

describe('the episodes table', () => {
  it('shows a row per episode of the open season and a state per Slot with a Version', async () => {
    const { grid } = await openSeries()
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 1 Standard: Filled' })).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 1 4K: Wanted' })).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Season 1 episode 2 Standard: Unreleased' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: 'Standard' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: '4K' })).toBeInTheDocument()
    expect(within(grid).getByText('—')).toBeInTheDocument() // the second episode has no air date yet
    // Specials are another tab, not rows of this table.
    expect(within(grid).queryByRole('button', { name: /Season 0 episode 1/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^Specials/ }))
    expect(within(grid).getByRole('button', { name: 'Season 0 episode 1 Standard: Unmonitored' })).toBeInTheDocument()
  })

  it('is operated entirely from the keyboard: arrows move, Space toggles an episode, x ticks it', async () => {
    const { state, grid } = await openSeries()
    // The Version controls above the pane's Series section have their own tab stops: start at the last control before the table.
    await act(async () => screen.getByRole('button', { name: 'Actions for Season 1' }).focus())
    await userEvent.tab() // the Name column's resize handle
    await userEvent.tab() // the table's one tab stop
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' })).toHaveFocus()

    // Right moves along the row onto the Standard cell; Space there toggles the episode's monitoring.
    await userEvent.keyboard('{ArrowRight}')
    expect(within(grid).getByRole('button', { name: /Season 1 episode 1 Standard/ })).toHaveFocus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(state.get().sent).toHaveLength(1))
    expect(state.get().sent[0]).toEqual({ path: 'episodes/monitor', body: { episode_ids: [2], monitored: false } })

    await userEvent.keyboard('{ArrowDown}')
    expect(within(grid).getByRole('button', { name: /Season 1 episode 2 Standard/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' })).toHaveFocus()
    await userEvent.keyboard('x')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' })).toBeChecked()

    // The keys stayed inside the table: the Library selection did not move.
    expect(screen.getByRole('option', { name: /breaking bad/i, selected: true })).toBeInTheDocument()

    await userEvent.keyboard('{Home}')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' })).toHaveFocus()
  })

  it('changes the monitoring mode from the detail pane', async () => {
    const { state } = await openSeries()
    await userEvent.click(await screen.findByRole('button', { name: /^(Monitored|Not monitored)/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Not monitored' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'titles', body: { series_monitor: 'none' } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Monitored|Not monitored)/ })).toHaveTextContent('Not monitored'))
  })

  it('is not shown for a Movie', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('heading', { name: 'Heat' })
    expect(screen.queryByRole('grid', { name: 'Episodes' })).not.toBeInTheDocument()
  })
})

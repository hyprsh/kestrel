// Components take their Slots from the Title's Versions, not a fixed pair: a Series and a Movie with four and five Slots
// (the third, fourth and fifth are fakes; #282 will supply real ones) render a column, a cell and a card for each.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'
import { serveSlots } from '../test/slots'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const keys = ['standard', '4k', 'german', 'remux'] as const
const version = (slot: string, i: number, state = 'wanted') => ({
  id: 50 + i,
  slot,
  profile: 'hd-primary',
  state,
  long_missing: false,
  wanted_since: null,
  file: null,
  added_at: '2026-10-17T12:00:00Z',
})
// The generated types know two Slots; the fake others come through a cast.
const cells = (states: Record<string, ReturnType<typeof cell>>) => states as unknown as ReturnType<typeof episode>['cells']
const versionsOf = (...slots: string[]) => slots.map((s, i) => version(s, i)) as unknown as ReturnType<typeof detail>['versions']

afterEach(() => localStorage.clear())

async function openFourSlotSeries(slotList: string[] = [...keys]) {
  const state = fakeSeries()
  const r = seriesRow(5, 'Breaking Bad')
  server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { kind: 'series', series_monitor: 'all', versions: versionsOf(...slotList) }))))
  return state
}

/** Opens the Series and returns its table once the newest season's episodes are drawn. */
async function show() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findByRole('rowgroup', { name: /episodes$/ })
  return screen.getByRole('table', { name: 'Versions and seasons' })
}
const seasonRowOf = (table: HTMLElement, n: number) =>
  within(table)
    .getByRole('button', { name: new RegExp(`^Season ${n}:`) })
    .closest<HTMLElement>('[role=row]')!

describe('a Series with four Slots', () => {
  it('has a column head per Version and a cell per Version in every episode row', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled') }) }),
      episode(3, 1, 5, 'Dead Freight', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('downloading') }) }),
      episode(4, 1, 6, 'Hazard Pay', { monitored: false, cells: cells({ standard: cell('unmonitored'), '4k': cell('unmonitored'), german: cell('unmonitored'), remux: cell('unmonitored') }) }),
    ]
    const table = await show()

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.getAttribute('aria-label') ?? h.textContent),
    ).toEqual(expect.arrayContaining(['Standard', '4K', 'German', 'Remux']))
    const dead = within(table).getByRole('row', { name: /Dead Freight/ })
    for (const label of ['S01E05 4K: Wanted', 'S01E05 Remux: Downloading']) expect(within(dead).getByRole('button', { name: label })).toBeInTheDocument()
    for (const label of ['S01E05 Standard: Have', 'S01E05 German: Have']) expect(within(dead).getByRole('button', { name: label })).toBeInTheDocument()

    const off = within(table).getByRole('row', { name: /Hazard Pay/ })
    expect(off).toHaveAttribute('data-monitored', 'off')
    for (const n of ['Standard', '4K', 'German', 'Remux']) expect(within(off).getByRole('button', { name: `S01E06 ${n}: Not monitored` })).toBeInTheDocument()
  })

  it.each([
    ['one Slot', ['standard'], ['Standard']],
    ['two Slots', ['standard', '4k'], ['Standard', '4K']],
  ])('has a column head and an episode cell for each Version with %s', async (_, slotList, names) => {
    const state = await openFourSlotSeries(slotList)
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted') }) })]
    const table = await show()

    for (const n of names) expect(within(table).getByRole('columnheader', { name: n })).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader', { name: /^(Standard|4K|German|Remux)$/ })).toHaveLength(names.length)
    const pilot = within(table).getByRole('row', { name: /Pilot/ })
    expect(within(pilot).getByRole('button', { name: 'S01E01 Standard: Have' })).toBeInTheDocument()
    if (names.length > 1) expect(within(pilot).getByRole('button', { name: 'S01E01 4K: Wanted' })).toBeInTheDocument()
  })

  it('gives a Series with more Versions than four a column for each', async () => {
    const state = await openFourSlotSeries([...keys, 'kids'])
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled'), kids: cell('wanted') }) })]
    const table = await show()
    expect(within(table).getAllByRole('columnheader', { name: /^(Standard|4K|German|Remux|Kids)$/ })).toHaveLength(5)
    expect(within(within(table).getByRole('row', { name: /Pilot/ })).getByRole('button', { name: 'S01E01 Kids: Wanted' })).toBeInTheDocument()
  })

  it('opens a menu of one Version from its cell: a file for a filled one, Search for just that Version for a Wanted one', async () => {
    const state = await openFourSlotSeries()
    const file = (n: string) => ({
      id: 70 + n.length,
      path: `/media/tv/Breaking Bad/Season 01/Breaking Bad - S01E01 - [${n}].mkv`,
      size: 2 ** 30,
      quality: 'WEBDL-1080p',
      episode_ids: [2],
      release_name: 'r',
      languages: [],
      imported_at: '2024-10-20T12:00:00Z',
      custom_formats: [],
    })
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled', 1, file('Standard')), '4k': cell('wanted'), german: cell('filled', 1, file('German')), remux: cell('wanted') }) }),
    ]
    const searched: unknown[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push({ version: Number(params.id), body: await request.json() })
        return response(202).json({ search_id: 'search-1' })
      }),
    )
    const table = await show()
    const pilot = within(within(table).getByRole('row', { name: /Pilot/ }))

    await userEvent.click(pilot.getByRole('button', { name: 'S01E01 German: Have' }))
    const pop = await screen.findByRole('dialog', { name: 'S01E01 German file' })
    expect(within(pop).getByText('S01E01 · German')).toBeInTheDocument()
    expect(within(pop).getByText(/\[German\]\.mkv$/)).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(pilot.getByRole('button', { name: 'S01E01 Remux: Wanted' }))
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([expect.stringContaining('Search S01E01 for Remux'), expect.stringContaining('Manual Search S01E01 (Remux)…')])
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Search S01E01 for Remux/ }))
    expect(await screen.findByText('Search started for S01E01 in Remux')).toBeInTheDocument()
    expect(searched).toEqual([{ version: 53, body: { season: 1, episode_ids: [2] } }])
  })

  it('draws a cell per Version in a season row: a check when it has the season, else what is Wanted, amber where some are', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled') }) }),
      episode(3, 1, 2, 'Some', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
    ]
    const table = await show()
    const row = within(seasonRowOf(table, 1))
    expect(row.getByRole('button', { name: 'Season 1, Standard: 2 of 2' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Season 1, German: 2 of 2' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Season 1, 4K: 1 Wanted' })).toHaveTextContent('1 Wanted')
    expect(row.getByRole('button', { name: 'Season 1, Remux: 1 Wanted' })).toBeInTheDocument()
    await userEvent.click(row.getByRole('button', { name: 'Season 1, 4K: 1 Wanted' }))
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([expect.stringContaining('Search Season 1 for 4K'), expect.stringContaining('Manual Search Season 1 (4K)…'), expect.stringContaining('Show the Wanted Episode')])
  })
})

describe('the menus of the Versions that hold no file', () => {
  it('opens Activity for a downloading Version, says a Version not aired is not out, and offers Monitor on one that is not monitored', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('downloading'), '4k': cell('unmonitored'), german: cell('unreleased'), remux: cell('wanted') }) })]
    const table = await show()
    const pilot = within(within(table).getByRole('row', { name: /Pilot/ }))

    await userEvent.click(pilot.getByRole('button', { name: /^S01E01 Standard: Downloading/ }))
    const dl = await screen.findByRole('menu')
    expect(within(dl).getByRole('menuitem', { name: /Open in Activity/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    expect(pilot.getByRole('button', { name: 'S01E01 German: Not out yet' })).toBeInTheDocument()

    await userEvent.click(pilot.getByRole('button', { name: 'S01E01 4K: Not monitored' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Monitor S01E01/ }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'episodes/monitor', body: { episode_ids: [2], monitored: true } }]))
  })
})

describe('a Movie with four Slots', () => {
  async function openMovie() {
    const r = row(1, 'Paddington in Peru', 'Paddington in Peru')
    fakeLibrary([r])
    const versions = [
      {
        ...version('standard', 1, 'filled'),
        file: { id: 1, path: '/media/movies/P/Paddington.mkv', size: 9 * 2 ** 30, quality: 'Bluray-1080p', imported_at: '2026-10-30T12:00:00Z', custom_formats: [], languages: [] },
      },
      version('4k', 2, 'wanted'),
      version('german', 3, 'wanted'),
      version('remux', 4, 'wanted'),
    ]
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { versions: versions as unknown as ReturnType<typeof detail>['versions'] }))))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    return screen.findByRole('region', { name: 'Paddington in Peru' })
  }

  it('shows a chip per Slot in the header and a card per Version', async () => {
    const pane = await openMovie()
    const chips = within(pane).getByRole('group', { name: 'Slots' })
    expect(Array.from(chips.querySelectorAll('[data-slot]')).map((c) => c.textContent)).toEqual(['STD', '4KWanted', 'GERWanted', 'REMWanted'])
    const cards = within(pane).getByRole('list', { name: 'Versions' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    for (const n of ['Standard', '4K', 'German', 'Remux']) expect(within(cards).getByRole('listitem', { name: n })).toBeInTheDocument()
    // Four Versions: no Add Version.
    expect(within(pane).queryByRole('button', { name: 'Add Version' })).not.toBeInTheDocument()
    // Each chip opens a popover of its Slot alone: the file of a filled one, the search of a Wanted one.
    await userEvent.click(within(chips).getByRole('button', { name: /^Standard:/ }))
    expect(await screen.findByRole('dialog', { name: 'Standard file' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(within(chips).getByRole('button', { name: /^German:/ }))
    const wanted = await screen.findByRole('dialog', { name: 'German Version' })
    expect(within(wanted).getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(within(wanted).getByRole('button', { name: 'Manual Search' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  })
})

describe('on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives the Monitored button and Search two large buttons, the Versions one card each and each episode a cell per Version', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const state = await openFourSlotSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })

    const monitor = await screen.findByRole('button', { name: /^Monitoring: / })
    expect(monitor).toHaveTextContent('All episodes')
    expect(screen.getByRole('button', { name: 'Search Wanted' })).toBeInTheDocument()

    const cards = screen.getByRole('list', { name: 'Versions' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    const pilot = within(screen.getByRole('row', { name: /Pilot/ }))
    expect(pilot.getByText('E01')).toBeInTheDocument()

    // Tapping a cell opens its actions as a bottom sheet; tapping the row does nothing.
    await userEvent.click(pilot.getByText('Pilot'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(pilot.getByRole('button', { name: 'S01E01 4K: Wanted' }))
    const sheet = await screen.findByRole('dialog', { name: 'S01E01 \u00b7 4K' })
    expect(within(sheet).getByText('Search S01E01 for 4K')).toBeInTheDocument()
  })
})

describe('the Series table on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('has one narrow column per Version headed by its short label, and selects all from the season menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
      episode(3, 1, 2, 'Cat', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    const grid = await screen.findByRole('rowgroup', { name: 'Season 1 episodes' })
    const table = screen.getByRole('table', { name: 'Versions and seasons' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Season', 'STD', '4K', 'GER', 'REM'])
    // No tick boxes until something is ticked.
    expect(within(grid).queryByRole('checkbox')).not.toBeInTheDocument()

    // Select-all is in the season's menu.
    await userEvent.click(screen.getByRole('button', { name: 'Season 1 Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select All Episodes' }))
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' })).toBeChecked()
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Season 1 Actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Deselect All Episodes' })).toBeInTheDocument()
  })
})

describe('Slots come from the Slot list', () => {
  async function openMovieIn(slots: string[], client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    const r = row(1, 'Paddington in Peru', 'Paddington in Peru')
    fakeLibrary([r])
    const versions = versionsOf(...slots)
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { versions }))))
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    return screen.findByRole('region', { name: 'Paddington in Peru' })
  }

  it('lists the Versions in the admin order under the stored labels, and follows a rename without a reload', async () => {
    const served = serveSlots(['archive', 'Remux archive'], ['standard', 'Streaming'], ['kids', 'Kids'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pane = await openMovieIn(['standard', 'archive'], client)
    const cards = within(pane).getByRole('list', { name: 'Versions' })
    await waitFor(() =>
      expect(
        within(cards)
          .getAllByRole('listitem')
          .map((c) => c.getAttribute('aria-label')),
      ).toEqual(['Remux archive', 'Streaming']),
    )

    served.rename('standard', 'Living room')
    await client.invalidateQueries({ queryKey: ['slots'] })
    await waitFor(() => expect(within(cards).getByRole('listitem', { name: 'Living room' })).toBeInTheDocument())
    expect(within(cards).queryByRole('listitem', { name: 'Streaming' })).not.toBeInTheDocument()
  })

  it('leaves the Slot name off the header chip when the library has one Slot', async () => {
    serveSlots(['standard', 'Standard'])
    const pane = await openMovieIn(['standard'])
    const chips = within(pane).getByRole('group', { name: 'Slots' })
    await waitFor(() => expect(Array.from(chips.querySelectorAll('[data-slot]')).map((c) => c.textContent)).toEqual(['Wanted']))
  })
})

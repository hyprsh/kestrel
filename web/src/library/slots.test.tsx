// Components take their Slots from the Title's Versions, not a fixed pair: a Series and a Movie with four and five Slots
// (the third, fourth and fifth are fakes; #282 will supply real ones) render a chip, a card and a Files row for each.
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

async function show() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('grid', { name: 'Episodes' })
}

describe('a Series with four Slots', () => {
  it('has one row per episode with a chip per Slot, short labels, and no column per Slot', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled') }) }),
      episode(3, 1, 5, 'Dead Freight', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('downloading') }) }),
      episode(4, 1, 6, 'Hazard Pay', { monitored: false, cells: cells({ standard: cell('unmonitored'), '4k': cell('unmonitored'), german: cell('unmonitored'), remux: cell('unmonitored') }) }),
    ]
    const grid = await show()

    const dead = within(grid).getByRole('row', { name: /Dead Freight/ })
    const chips = Array.from(dead.querySelectorAll('[data-slot]'))
    expect(chips.map((c) => c.textContent)).toEqual(['STD', '4K', 'GER', 'REM'])
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['filled', 'wanted', 'filled', 'downloading'])
    expect(within(dead).getByTitle(/^4K: Wanted \d+ d$/)).toBeInTheDocument()
    expect(grid.querySelectorAll('th').length).toBeLessThanOrEqual(7) // the columns do not grow with the Slots

    const off = within(grid).getByRole('row', { name: /Hazard Pay/ })
    expect(off).toHaveAttribute('data-monitored', 'off')
    expect(Array.from(off.querySelectorAll('[data-slot]')).map((c) => c.getAttribute('data-state'))).toEqual(['unmonitored', 'unmonitored', 'unmonitored', 'unmonitored'])
  })

  it.each([
    ['one Slot', ['standard'], ['STD']],
    ['two Slots', ['standard', '4k'], ['STD', '4K']],
  ])('has the one column header "Slots" and a labelled chip in every row with %s', async (_, slotList, labels) => {
    const state = await openFourSlotSeries(slotList)
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted') }) })]
    const grid = await show()

    expect(within(grid).getByRole('columnheader', { name: 'Slots' })).toBeInTheDocument()
    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    const chips = Array.from(within(pilot).getByRole('group', { name: 'S01E01 Slots' }).querySelectorAll('[data-slot]'))
    expect(chips.map((c) => c.textContent)).toEqual(labels) // no bare dot, whatever the number of Slots
    chips.forEach((c) => expect(c).toHaveAccessibleName(/: /))
  })

  it('folds the Slots past four into a +N chip whose tooltip lists them', async () => {
    const state = await openFourSlotSeries([...keys, 'kids', 'mobile'])
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', {
        cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled'), kids: cell('wanted'), mobile: cell('downloading') }),
      }),
    ]
    const grid = await show()

    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    expect(pilot.querySelectorAll('[data-slot]')).toHaveLength(4)
    const more = pilot.querySelector('[data-more]')!
    expect(more).toHaveTextContent('+2')
    expect(more.getAttribute('title')).toMatch(/^Kids: Wanted \d+ d\nMobile: /)
  })

  it('opens a popover of one Slot from its chip: a file for a filled Slot, Search for just that Slot for a Wanted one', async () => {
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
    const grid = await show()
    const group = within(grid).getByRole('group', { name: 'S01E01 Slots' })

    await userEvent.click(within(group).getByRole('button', { name: /^German:/ }))
    const pop = await screen.findByRole('dialog', { name: 'S01E01 German file' })
    expect(within(pop).getByText('S01E01 \u00b7 German')).toBeInTheDocument()
    expect(within(pop).getByText(/\[German\]\.mkv$/)).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(group).getByRole('button', { name: /^Remux:/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'S01E01 Remux' })).getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Search started for S01E01 in Remux')).toBeInTheDocument()
    expect(searched).toEqual([{ version: 53, body: { season: 1, episode_ids: [2] } }])
  })

  it('draws one bar per season, a count chip per Slot, amber where some Slots are Wanted', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled') }) }),
      episode(3, 1, 2, 'Some', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
    ]
    await show()
    const row = within(screen.getByRole('region', { name: 'Seasons' }))
      .getByRole('button', { name: /^Season 1:/ })
      .closest<HTMLElement>('[role=listitem]')!
    expect(Array.from(row.querySelectorAll('[data-bar]')).map((q) => q.getAttribute('data-bar'))).toEqual(['filled', 'partial'])
    expect(row).toHaveTextContent(/STD\s*2\/2/)
    expect(row).toHaveTextContent(/4K\s*1\/2/)
    expect(row).toHaveTextContent(/GER\s*2\/2/)
    expect(row).toHaveTextContent(/REM\s*1\/2/)
    expect(within(row).getByTitle('4K 1 of 2, 1 Wanted')).toHaveAttribute('data-state', 'wanted')
  })
})

describe('the popovers of the Slots that hold no file', () => {
  it('says what a downloading Slot is doing with a link to Activity, and offers Monitor on a Slot that is not monitored', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('downloading'), '4k': cell('unmonitored'), german: cell('unreleased'), remux: cell('wanted') }) })]
    const grid = await show()
    const group = within(grid).getByRole('group', { name: 'S01E01 Slots' })

    await userEvent.click(within(group).getByRole('button', { name: /^Standard:/ }))
    const dl = await screen.findByRole('dialog', { name: 'S01E01 Standard' })
    expect(within(dl).getByRole('button', { name: 'View in Activity' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(group).getByRole('button', { name: /^German:/ }))
    expect(await screen.findByRole('dialog', { name: 'S01E01 German' })).toHaveTextContent('Airs')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(group).getByRole('button', { name: /^4K:/ }))
    const off = await screen.findByRole('dialog', { name: 'S01E01 4K' })
    expect(off).toHaveTextContent('Not monitored')
    await userEvent.click(within(off).getByRole('button', { name: 'Monitor' }))
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

  it('shows a chip per Slot in the header and a row per Version in the accordion', async () => {
    const pane = await openMovie()
    const chips = within(pane).getByRole('group', { name: 'Slots' })
    expect(Array.from(chips.querySelectorAll('[data-slot]')).map((c) => c.textContent)).toEqual(['STD', '4KWanted', 'GERWanted', 'REMWanted'])
    const cards = within(pane).getByRole('region', { name: 'Versions' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    for (const n of ['Standard', '4K', 'German', 'Remux']) expect(within(cards).getByRole('listitem', { name: n })).toBeInTheDocument()
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
    // The Slots that are Wanted open by themselves; the filled one is closed.
    expect(within(cards).getByRole('button', { name: /^Standard:/ })).toHaveAttribute('aria-expanded', 'false')
    for (const n of ['4K', 'German', 'Remux']) expect(within(cards).getByRole('button', { name: new RegExp(`^${n}:`) })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives the Monitored button and Search two large buttons and each episode its chips under the name, with a large bookmark', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const state = await openFourSlotSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) })]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    const monitor = await screen.findByRole('button', { name: /^Monitoring: / })
    expect(monitor).toHaveTextContent('All episodes')
    expect(screen.getByRole('button', { name: 'Search Wanted' })).toBeInTheDocument()

    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    expect(pilot.querySelectorAll('[data-slot]')).toHaveLength(4)
    expect(within(pilot).getByText('E01')).toBeInTheDocument()
    expect(within(pilot).getByRole('button', { name: 'Stop Monitoring S01E01' })).toBeInTheDocument()

    // Tapping a chip opens its popover; tapping the row does nothing.
    await userEvent.click(within(pilot).getByText('Pilot'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(within(pilot).getByRole('button', { name: /^4K:/ }))
    expect(await screen.findByRole('dialog', { name: 'S01E01 4K' })).toBeInTheDocument()
  })
})

describe('the episode table on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('has no header row above its rows, keeps each name and its chips on one line, and selects all from the season menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
      episode(3, 1, 2, 'Cat', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    // Nothing heads the one column: no header row and no tick-all box above the rows.
    expect(within(grid).queryAllByRole('columnheader')).toHaveLength(0)
    expect(within(grid).queryByRole('checkbox', { name: 'Select All of Season 1' })).not.toBeInTheDocument()
    // The name and its chips share one container, so they sit on one line when they fit.
    const pilot = within(grid).getByRole('row', { name: /Pilot/ })
    expect(within(pilot).getByText('Pilot').closest('div')).toContainElement(pilot.querySelector('[data-slot]') as HTMLElement)

    // Select-all is in the season's menu.
    await userEvent.click(screen.getByRole('button', { name: 'Season 1 actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select All of Season 1' }))
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 1' })).toBeChecked()
    expect(within(grid).getByRole('checkbox', { name: 'Select Season 1 episode 2' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Season 1 actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Deselect All of Season 1' })).toBeInTheDocument()
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
    const cards = within(pane).getByRole('region', { name: 'Versions' })
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

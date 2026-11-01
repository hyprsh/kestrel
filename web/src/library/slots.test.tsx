// Components take their Slots from the Title's Versions, not a fixed pair: a Series and a Movie with four and five Slots
// (the third, fourth and fifth are fakes; #282 will supply real ones) render a chip, a card and a Files row for each.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

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
    expect(chips.map((c) => c.textContent)).toEqual(['STD', '4K', 'GERMAN', 'REMUX'])
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['filled', 'wanted', 'filled', 'downloading'])
    expect(within(dead).getByTitle(/^4K: Wanted \d+ d$/)).toBeInTheDocument()
    expect(grid.querySelectorAll('th').length).toBeLessThanOrEqual(7) // the columns do not grow with the Slots

    const off = within(grid).getByRole('row', { name: /Hazard Pay/ })
    expect(off).toHaveAttribute('data-monitored', 'off')
    expect(Array.from(off.querySelectorAll('[data-slot]')).map((c) => c.getAttribute('data-state'))).toEqual(['unmonitored', 'unmonitored', 'unmonitored', 'unmonitored'])
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

  it('lists every Slot in the opened row with its state, file, size and action, and Search for a Wanted Slot searches only that one', async () => {
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
        return response(202).empty()
      }),
    )
    const grid = await show()
    await userEvent.click(within(grid).getByRole('button', { name: 'Open S01E01' }))

    const slots = within(grid).getByRole('list', { name: 'Slots of S01E01' })
    const items = within(slots).getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-slot-row'))).toEqual([...keys])
    expect(items[0]).toHaveTextContent('Standard1080p · 1.0 GB')
    expect(items[2]).toHaveTextContent('German1080p · 1.0 GB')
    expect(within(items[2]).getByText(/\[German\]\.mkv$/)).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'File details for Standard' })).toBeInTheDocument()
    expect(within(items[3]).getByRole('button', { name: 'Search Remux' })).toBeInTheDocument()

    await userEvent.click(within(items[3]).getByRole('button', { name: 'Search Remux' }))
    expect(await screen.findByText('Search started for S01E01 in Remux')).toBeInTheDocument()
    expect(searched).toEqual([{ version: 53, body: { season: 1, episode_ids: [2] } }])
  })

  it('draws one strip per season, a count chip per Slot and half green, half amber where some Slots are Wanted', async () => {
    const state = await openFourSlotSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: cells({ standard: cell('filled'), '4k': cell('filled'), german: cell('filled'), remux: cell('filled') }) }),
      episode(3, 1, 2, 'Some', { cells: cells({ standard: cell('filled'), '4k': cell('wanted'), german: cell('filled'), remux: cell('wanted') }) }),
    ]
    await show()
    const row = within(screen.getByRole('region', { name: 'Seasons' })).getByRole('button', { name: /^Season 1:/ })
    expect(Array.from(row.querySelectorAll('[data-square]')).map((q) => q.getAttribute('data-square'))).toEqual(['filled', 'partial'])
    expect(row).toHaveTextContent('STD 2/2')
    expect(row).toHaveTextContent('4K 1/2')
    expect(row).toHaveTextContent('GERMAN 2/2')
    expect(row).toHaveTextContent('REMUX 1/2')
    expect(within(row).getByTitle('4K 1 of 2, 1 Wanted')).toHaveAttribute('data-wanted')
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

  it('shows a chip per Slot in the header, a card per Version and a Files row per Slot', async () => {
    const pane = await openMovie()
    const chips = within(pane).getByRole('group', { name: 'Slots' })
    expect(Array.from(chips.querySelectorAll('[data-slot]')).map((c) => c.textContent)).toEqual(['STD', '4KWanted', 'GERMANWanted', 'REMUXWanted'])
    const cards = within(pane).getByRole('region', { name: 'Versions' })
    expect(within(cards).getAllByRole('list')).toHaveLength(4)
    for (const n of ['Standard', '4K', 'German', 'Remux']) expect(within(cards).getByRole('list', { name: n })).toBeInTheDocument()
    const files = within(pane).getByRole('region', { name: 'Files' })
    for (const n of ['Standard', '4K', 'German', 'Remux']) expect(within(files).getAllByText(n).length).toBeGreaterThan(0)
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
    expect(within(pilot).getByRole('button', { name: 'Stop monitoring S01E01' })).toBeInTheDocument()

    // Tapping the row opens it.
    await userEvent.click(within(pilot).getByText('Pilot'))
    expect(within(grid).getByRole('list', { name: 'Slots of S01E01' })).toBeInTheDocument()
  })
})

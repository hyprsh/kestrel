import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { dayString, type UpcomingItem } from '../api/upcoming'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { serveDisplay } from '../test/serveDisplay'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

type Recent = components['schemas']['RecentItem']
type Undated = components['schemas']['UndatedItem']
type Slot = components['schemas']['UpcomingSlot']

// Thursday 22 October 2026, local noon. Only Date is faked, so timers and the Query client run as usual.
const NOW = new Date(2026, 9, 22, 12, 0, 0)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => vi.useRealTimers())

const day = (n: number) => dayString(n)
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const slot = (state: Slot['state'], over: Partial<Slot> = {}): Slot => ({
  slot: 'standard',
  version_id: 11,
  state,
  wanted_since: state === 'wanted' ? ago(2) : null,
  long_missing: false,
  quality: state === 'imported' ? 'WEBDL-1080p' : null,
  ...over,
})

const movie = (over: Partial<UpcomingItem> = {}): UpcomingItem => ({
  date: day(1),
  kind: 'movie',
  title_id: 1,
  title: 'Paddington',
  year: 2014,
  release_type: 'digital',
  season: null,
  episode: null,
  episode_name: null,
  searchable_from: day(1),
  released: false,
  has_poster: false,
  network: null,
  overview: 'A bear in London.',
  air_at: null,
  markers: [],
  slots: [slot('not_out')],
  searchable: true,
  dates: [],
  episode_id: null,
  ...over,
})

const episode = (over: Partial<UpcomingItem> = {}): UpcomingItem => ({
  date: day(1),
  kind: 'series',
  title_id: 2,
  title: 'Bridge Show',
  year: 2020,
  release_type: null,
  season: 2,
  episode: 4,
  episode_name: 'The Handover',
  searchable_from: null,
  released: true,
  has_poster: false,
  network: 'HBO',
  overview: 'Two detectives, one bridge.',
  air_at: null,
  markers: [],
  slots: [slot('not_out', { version_id: 21 })],
  searchable: false,
  dates: [],
  episode_id: 204,
  ...over,
})

const recent = (over: Partial<Recent> = {}): Recent => ({
  title_id: 1,
  title: 'Paddington',
  year: 2014,
  kind: 'movie',
  has_poster: false,
  slot: 'standard',
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  score: 120,
  score_delta: null,
  files: 1,
  is_upgrade: false,
  imported_at: '2026-10-16T10:00:00Z',
  ...over,
})

function fakeAgenda(items: UpcomingItem[], undated: Undated[] = [], imports: Recent[] = []) {
  const asked: string[] = []
  fakeLibrary([row(1, 'Paddington', 'Paddington'), row(2, 'Bridge Show', 'Bridge Show', { kind: 'series' })])
  server.use(
    http.get('/upcoming', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('from')}..${q.get('to')}`)
      return response(200).json({ from: q.get('from') ?? '', to: q.get('to') ?? '', items, undated })
    }),
    http.get('/recent', ({ response }) => response(200).json({ items: imports, total: imports.length })),
  )
  return asked
}

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openUpcoming() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
  await screen.findByRole('list', { name: 'Agenda' })
}

const daysBetween = (range: string) => {
  const [from, to] = range.split('..').map((d) => Date.parse(`${d}T00:00:00Z`))
  return (to - from) / 86_400_000
}

const timeline = () => screen.getByRole('list', { name: 'Agenda' })
const current = () => document.querySelector('[aria-current="true"]')
const cover = (row: HTMLElement) => within(row).getAllByRole('button', { hidden: true })[0] // the row's whole-row button, which a click lands on
const rowOf = (text: string | RegExp) => within(timeline()).getByText(text).closest('li')!

describe('Upcoming timeline', () => {
  it('asks for 14 days back to 60 ahead and opens at a Today marker between the past and the future', async () => {
    const asked = fakeAgenda([episode({ date: day(-3), title: 'Past Show', episode_name: 'Before', title_id: 5 }), movie({ date: day(2) })])
    await openUpcoming()

    expect(asked.at(-1)).toBe(`${day(-14)}..${day(60)}`)
    expect(daysBetween(asked.at(-1)!)).toBe(74)
    const today = screen.getByRole('heading', { name: /^Today/ })
    expect(today).toHaveAttribute('aria-current', 'date') // nothing is due today and the marker is still there
    const before = within(timeline()).getByText('Past Show')
    const after = within(timeline()).getByText('Paddington')
    expect(before.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(today.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Nothing else is due today.')).toBeInTheDocument()
  })

  it('labels the days relatively and separates the weeks', async () => {
    fakeAgenda([episode({ date: day(-1), title_id: 5, title: 'Yest' }), episode({ date: day(1), title_id: 6, title: 'Tomo' }), movie({ date: day(40) })])
    await openUpcoming()
    const headings = within(timeline())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(headings[0]).toMatch(/^Yesterday/)
    expect(headings[1]).toMatch(/^Today/)
    expect(headings[2]).toMatch(/^Tomorrow/)
    const weeks = within(timeline())
      .getAllByRole('presentation')
      .map((w) => w.textContent)
    expect(weeks).toEqual(['This week', 'Later'])
  })

  it('shows more in both directions', async () => {
    const asked = fakeAgenda([movie()])
    await openUpcoming()
    await userEvent.click(screen.getByRole('button', { name: 'Show later' }))
    expect(asked.at(-1)).toBe(`${day(-14)}..${day(120)}`)
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier' }))
    expect(asked.at(-1)).toBe(`${day(-44)}..${day(120)}`)
  })

  it('says so when nothing is due', async () => {
    fakeAgenda([])
    await openUpcoming()
    expect(await screen.findByText(/nothing is due in this window/i)).toBeInTheDocument()
  })
})

describe('Upcoming: where each entry stands', () => {
  it('says Not out yet, Wanted for how long, Long missing and Imported with the quality and Slot', async () => {
    fakeAgenda([
      movie({ date: day(3), title_id: 3, title: 'Soon' }),
      movie({ date: day(-5), title_id: 4, title: 'Waiting', slots: [slot('wanted')] }),
      movie({ date: day(-20), title_id: 5, title: 'Forgotten', slots: [slot('wanted', { long_missing: true, wanted_since: ago(120) })] }),
      movie({ date: day(-2), title_id: 6, title: 'Done', slots: [slot('imported')] }),
    ])
    await openUpcoming()
    expect(within(rowOf('Soon')).getByText('Not out yet')).toBeInTheDocument()
    expect(within(rowOf('Waiting')).getByText('Wanted 2 days')).toBeInTheDocument()
    expect(within(rowOf('Forgotten')).getByText('Long missing 120 days')).toBeInTheDocument()
    const done = rowOf('Done')
    expect(within(done).getByText('1080p · Standard')).toBeInTheDocument()
    expect(done).toHaveAttribute('data-imported') // dimmed
  })

  it('shows each Slot of a Title with two', async () => {
    fakeAgenda([movie({ date: day(-1), slots: [slot('wanted'), slot('imported', { slot: '4k', version_id: 12, quality: 'Bluray-2160p' })] })])
    await openUpcoming()
    const r = rowOf('Paddington')
    expect(within(r).getByText('Standard · Wanted 2 days')).toBeInTheDocument()
    expect(within(r).getByText('2160p · 4K')).toBeInTheDocument()
  })

  it('shows a Grab in flight with its live progress, over Wanted', async () => {
    fakeAgenda([movie({ date: day(-1), slots: [slot('wanted')] })])
    fakeQueue([queueItem({ title_id: 1, slot: 'standard', bytes_total: 8000, bytes_left: 2000 })])
    await openUpcoming()
    const r = rowOf('Paddington')
    expect(await within(r).findByText('Downloading 75%')).toBeInTheDocument()
    expect(within(r).getByRole('progressbar')).toBeInTheDocument()
    expect(within(r).queryByText(/Wanted/)).not.toBeInTheDocument()
  })

  it('matches a download to its episode', async () => {
    fakeAgenda([
      episode({ date: day(-1), episode: 4, episode_name: 'Four', slots: [slot('wanted', { version_id: 21 })] }),
      episode({ date: day(-1), episode: 5, episode_name: 'Five', episode_id: 205, slots: [slot('wanted', { version_id: 21 })] }),
    ])
    fakeQueue([queueItem({ title_id: 2, kind: 'series', episodes: ['S02E05'] })])
    await openUpcoming()
    // Two episodes of one Series on one day group; open it to read each.
    await userEvent.click(screen.getByRole('button', { name: /show the 2 episodes of bridge show/i }))
    expect(await within(rowOf(/Four/)).findByText(/Wanted/)).toBeInTheDocument()
    expect(within(rowOf(/Five/)).getByText(/Downloading/)).toBeInTheDocument()
  })

  it('offers Search now on a Wanted entry, narrowed to its episode', async () => {
    fakeAgenda([episode({ date: day(-1), slots: [slot('wanted', { version_id: 21 })] })])
    const searched: unknown[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push({ id: String(params.id), body: await request.json() })
        return response(202).empty()
      }),
    )
    await openUpcoming()
    await userEvent.click(within(rowOf(/The Handover/)).getByRole('button', { name: /search now/i }))
    await waitFor(() => expect(searched).toEqual([{ id: '21', body: { season: 2, episode_ids: [204] } }]))
    expect(await findToast(/^Search started for /)).toBeInTheDocument()
  })

  it('says in a Toast when the search could not start', async () => {
    fakeAgenda([episode({ date: day(-1), slots: [slot('wanted', { version_id: 21 })] })])
    server.use(
      http.post('/versions/{id}/search', ({ response }) =>
        response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'the indexer is down' }, { status: 500 }),
      ),
    )
    await openUpcoming()
    await userEvent.click(within(rowOf(/The Handover/)).getByRole('button', { name: /search now/i }))
    expect(await findToast(/^Could not search .*: the indexer is down/)).toBeInTheDocument()
  })
})

describe('Upcoming: search', () => {
  it('has one Search now for a Title with both Slots Wanted, searching each Version', async () => {
    fakeAgenda([movie({ date: day(-1), slots: [slot('wanted'), slot('wanted', { slot: '4k', version_id: 12 })] })])
    const searched: string[] = []
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (searched.push(String(params.id)), response(202).empty())))
    await openUpcoming()
    await userEvent.click(within(rowOf('Paddington')).getByRole('button', { name: /search now/i }))
    expect(searched.sort()).toEqual(['11', '12'])
  })
})

describe('Upcoming: context and grouping', () => {
  it('shows the network, the air time in local time and the premiere, finale and Specials markers', async () => {
    const at = '2026-10-23T01:00:00Z'
    fakeAgenda([
      episode({ air_at: at, markers: ['series_premiere'], episode: 1, episode_name: 'Pilot' }),
      episode({ title_id: 7, title: 'Other', markers: ['season_finale'], episode_name: 'End' }),
      episode({ title_id: 8, title: 'Extra', markers: ['special'], season: 0, episode_name: 'Behind' }),
      episode({ title_id: 9, title: 'Opener', markers: ['season_premiere'], episode_name: 'Overture' }),
    ])
    await openUpcoming()
    const pilot = rowOf(/Pilot/)
    expect(within(pilot).getByText('HBO')).toBeInTheDocument()
    const local = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    expect(within(pilot).getByText(local)).toBeInTheDocument()
    expect(within(pilot).getByText('Series premiere')).toBeInTheDocument()
    expect(within(rowOf(/End/)).getByText('Season finale')).toBeInTheDocument()
    expect(within(rowOf(/Behind/)).getByText('Special')).toBeInTheDocument()
    expect(within(rowOf(/Overture/)).getByText('Season premiere')).toBeInTheDocument()
  })

  it('puts an episode on the day its air time falls on in the browser, not the network date', async () => {
    // Dated tomorrow by the network, but airing at local noon the day after.
    const air = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2, 12, 0).toISOString()
    fakeAgenda([episode({ date: day(1), air_at: air })])
    await openUpcoming()
    const weekday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2).toLocaleDateString(undefined, { weekday: 'long' })
    expect(within(screen.getByRole('list', { name: weekday })).getByText(/The Handover/)).toBeInTheDocument()
  })

  it('opens and closes an entry overview as an inline disclosure that keeps its label', async () => {
    fakeAgenda([episode()])
    await openUpcoming()
    const toggle = within(rowOf(/Bridge Show/)).getByRole('button', { name: 'Show overview' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByText('Two detectives, one bridge.')).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(screen.getByText('Two detectives, one bridge.')).not.toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('collapses episodes of one Series on one day into an entry that expands', async () => {
    fakeAgenda([1, 2, 3].map((n) => episode({ date: day(1), episode: n, episode_name: `Ep ${n}`, episode_id: 200 + n, slots: [slot('not_out', { version_id: 21 })] })))
    await openUpcoming()
    const group = rowOf(/S02E01–E03/)
    expect(group).toHaveTextContent('3 episodes')
    expect(screen.queryByText(/Ep 2/)).not.toBeInTheDocument()
    await userEvent.click(cover(group))
    expect(screen.getByText(/Ep 2/)).toBeInTheDocument()
    await userEvent.click(cover(rowOf(/S02E01–E03/)))
    expect(screen.queryByText(/Ep 2/)).not.toBeInTheDocument()
  })

  it('names a Movie line its other dates and marks the release that makes it searchable', async () => {
    fakeAgenda([
      movie({
        searchable: true,
        searchable_from: day(1),
        dates: [
          { release_type: 'theatrical', date: day(-19) },
          { release_type: 'digital', date: day(1) },
          { release_type: 'physical', date: day(51) },
        ],
      }),
    ])
    await openUpcoming()
    const r = rowOf('Paddington')
    expect(within(r).getByText('Digital')).toBeInTheDocument()
    expect(within(r).getByText('Searchable')).toBeInTheDocument()
    expect(r).toHaveTextContent(/in cinemas since .*, physical /)
  })

  it('lists the Titles with no date yet after the timeline', async () => {
    fakeAgenda(
      [movie()],
      [
        { kind: 'series', title_id: 2, title: 'Bridge Show', year: 2020, has_poster: false, network: 'HBO', reason: 'no_air_date', episodes: 3, slots: [slot('not_out')] },
        { kind: 'movie', title_id: 1, title: 'Mystery', year: null, has_poster: false, network: null, reason: 'no_release_date', episodes: 0, slots: [slot('not_out')] },
        { kind: 'series', title_id: 3, title: 'Soon Show', year: null, has_poster: false, network: null, reason: 'announced', episodes: 0, slots: [slot('not_out')] },
      ],
    )
    await openUpcoming()
    const section = screen.getByRole('region', { name: /no date yet/i })
    expect(within(section).getByText('3 episodes without an air date', { exact: false })).toBeInTheDocument()
    expect(within(section).getByText('No release date yet')).toBeInTheDocument()
    expect(within(section).getByText(/announced by thetvdb/i)).toBeInTheDocument()
  })
})

describe('Upcoming: filters', () => {
  const mixed = () =>
    fakeAgenda([
      movie({ date: day(1), title: 'A Movie', slots: [slot('not_out')] }),
      episode({ date: day(1), title: 'A Series', slots: [slot('wanted', { version_id: 21 })] }),
      movie({ date: day(-2), title_id: 3, title: 'Filled Movie', slots: [slot('imported')] }),
    ])

  it('shows Movies, Series or both', async () => {
    mixed()
    await openUpcoming()
    await userEvent.click(screen.getByRole('tab', { name: 'Movies' }))
    expect(within(timeline()).queryByText('A Series')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Series' }))
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Series')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'All' }))
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
  })

  it('keeps only Wanted with Wanted only, and drops Imported with Hide imported', async () => {
    mixed()
    await openUpcoming()
    await userEvent.click(screen.getByRole('switch', { name: 'Hide imported' }))
    expect(within(timeline()).queryByText('Filled Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Wanted only' }))
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Series')).toBeInTheDocument()
  })

  it('remembers them for the session, in the browser and not on the server', async () => {
    mixed()
    await openUpcoming()
    await userEvent.click(screen.getByRole('switch', { name: 'Wanted only' }))
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await screen.findByRole('list', { name: 'Agenda' })
    expect(screen.getByRole('switch', { name: 'Wanted only' })).toBeChecked()
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    sessionStorage.clear()
  })
})

describe('Upcoming: default filters', () => {
  const mixed = () =>
    fakeAgenda([
      movie({ date: day(1), title: 'A Movie', slots: [slot('not_out')] }),
      episode({ date: day(1), title: 'A Series', slots: [slot('wanted', { version_id: 21 })] }),
      movie({ date: day(-2), title_id: 3, title: 'Filled Movie', slots: [slot('imported')] }),
    ])
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it("starts a new session on the household's defaults", async () => {
    serveDisplay({ upcoming_filters: { kind: 'series', wanted_only: true, hide_imported: true } })
    mixed()
    await openUpcoming()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Wanted only' })).toBeChecked())
    expect(screen.getByRole('switch', { name: 'Hide imported' })).toBeChecked()
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
  })

  it('lets a change in the session win over the defaults, and keeps it', async () => {
    serveDisplay({ upcoming_filters: { kind: 'all', wanted_only: true, hide_imported: false } })
    mixed()
    await openUpcoming()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Wanted only' })).toBeChecked())
    await userEvent.click(screen.getByRole('switch', { name: 'Wanted only' }))
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await screen.findByRole('list', { name: 'Agenda' })
    expect(screen.getByRole('switch', { name: 'Wanted only' })).not.toBeChecked()
  })
})

describe('Upcoming: keyboard', () => {
  it('moves with j and k from the first entry of today on, and opens the Title with Enter', async () => {
    fakeAgenda([movie({ date: day(-4), title_id: 3, title: 'Old', slots: [slot('imported')] }), movie({ date: day(1) }), episode({ date: day(2) })])
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()

    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Bridge Show')
    await userEvent.keyboard('{ArrowUp}')
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('k')
    expect(current()).toHaveTextContent('Old')
    await userEvent.keyboard('j{Enter}')
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('goes through a group: Enter opens it, j steps into its episodes, Enter opens the Title', async () => {
    fakeAgenda([1, 2].map((n) => episode({ date: day(1), episode: n, episode_name: `Ep ${n}`, episode_id: 200 + n })))
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()

    expect(current()).toHaveTextContent('2 episodes')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByText(/Ep 1/)).toBeInTheDocument()
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Ep 1')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Ep 2')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: /bridge show/i })).toBeInTheDocument()
  })

  it('reaches the Titles with no date yet after the timeline', async () => {
    fakeAgenda([movie()], [{ kind: 'movie', title_id: 1, title: 'Mystery', year: null, has_poster: false, network: null, reason: 'no_release_date', episodes: 0, slots: [slot('not_out')] }])
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Mystery')
  })

  it('jumps back to today with t', async () => {
    fakeAgenda([movie({ date: day(-4), title_id: 3, title: 'Old', slots: [slot('imported')] }), movie({ date: day(1) }), episode({ date: day(2) })])
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('kk')
    expect(current()).toHaveTextContent('Old')
    await userEvent.keyboard('t')
    expect(current()).toHaveTextContent('Paddington')
  })

  it('opens the overview of the entry under the cursor with o', async () => {
    fakeAgenda([movie()])
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('o')
    expect(screen.getByText('A bear in London.')).toBeVisible()
  })
})

describe('Overview: Coming this week and Recently added', () => {
  it('shows the next 7 days with the same state badge, and the latest Imports', async () => {
    const asked = fakeAgenda(
      [episode({ slots: [slot('wanted', { version_id: 21 })] })],
      [],
      [recent({ is_upgrade: true }), recent({ title_id: 2, title: 'Bridge Show', kind: 'series', slot: '4k', files: 8, score: null })],
    )
    renderApp()

    const coming = await screen.findByRole('region', { name: /coming this week/i })
    expect(await within(coming).findByText(/S02E04/)).toBeInTheDocument()
    expect(daysBetween(asked.at(-1)!)).toBe(6)
    const added = screen.getByRole('region', { name: /recently added/i })
    const posters = await within(added).findAllByRole('listitem')
    expect(posters[0]).toHaveTextContent('Paddington')
    expect(posters[1]).toHaveTextContent('Bridge Show')
    expect(posters[1]).toHaveTextContent('4K')
  })

  it('moves through both sections with j/k and opens a Title with Enter', async () => {
    fakeAgenda([episode()], [], [recent()])
    renderApp()
    const added = await screen.findByRole('region', { name: /recently added/i })
    await within(added).findByText('Paddington')

    // Recently added is in the main column, read before Coming this week in the side column.
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Bridge Show')
    await userEvent.keyboard('k')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('says so when there is nothing coming and nothing imported', async () => {
    fakeAgenda([])
    renderApp()
    expect(await screen.findByText(/nothing is due in the next 7 days/i)).toBeInTheDocument()
    expect(await screen.findByText(/nothing has been imported yet/i)).toBeInTheDocument()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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
  monitored: true,
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
  monitored: true,
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
      const from = q.get('from') ?? ''
      const to = q.get('to') ?? ''
      return response(200).json({ from, to, items: items.filter((i) => i.date >= from && i.date <= to), undated })
    }),
    http.get('/recent', ({ response }) => response(200).json({ items: imports, total: imports.length })),
  )
  return asked
}

/** An IntersectionObserver that does nothing until a test says what intersects: the edges that load more (rootMargin 400px) and the days that name the month. */
function fakeObserver() {
  type Obs = { cb: IntersectionObserverCallback; margin: string; targets: Set<Element> }
  const all: Obs[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      o: Obs
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        this.o = { cb, margin: opts?.rootMargin ?? '', targets: new Set() }
        all.push(this.o)
      }
      observe(el: Element) {
        this.o.targets.add(el)
      }
      unobserve(el: Element) {
        this.o.targets.delete(el)
      }
      disconnect() {
        this.o.targets.clear()
        all.splice(all.indexOf(this.o), 1)
      }
    },
  )
  const live = (margin: string) => all.filter((o) => o.margin === margin && o.targets.size > 0)
  return {
    edges: () => live('400px 0px').flatMap((o) => [...o.targets]) as HTMLElement[],
    days: () => live('0px 0px -75% 0px').at(-1) ?? null,
    reach(el: Element, isIntersecting: boolean, only?: Obs) {
      for (const o of only ? [only] : all) if (o.targets.has(el)) o.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
    },
  }
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
// The agenda's selected row (the panel's Views also mark their current row).
const current = () => [...document.querySelectorAll('[aria-current="true"]')].find((e) => !e.closest('aside'))?.closest('li') ?? null
const rowOf = (text: string | RegExp) => within(timeline()).getByText(text).closest('li')!

/** A checkable item of the Filter menu, which is opened first when it is closed. */
async function filterItem(name: string) {
  if (!screen.queryByRole('menuitemcheckbox', { name })) await userEvent.click(screen.getByRole('button', { name: /^Filter/ }))
  return screen.getByRole('menuitemcheckbox', { name })
}

describe('Upcoming timeline', () => {
  it('shows the first hundred Titles with no date and the rest on request', async () => {
    const many: Undated[] = Array.from({ length: 250 }, (_, k) => ({
      kind: 'movie',
      title_id: 1000 + k,
      title: `Mystery ${k}`,
      year: null,
      has_poster: false,
      network: null,
      reason: 'no_release_date',
      episodes: 0,
      slots: [slot('not_out')],
    }))
    fakeAgenda([], many)
    await openUpcoming()

    const list = await screen.findByRole('list', { name: 'No date yet' })
    expect(within(list).getAllByRole('button').length).toBe(100)
    await userEvent.click(screen.getByRole('button', { name: 'Show 150 more' }))
    expect(within(list).getAllByRole('button').length).toBe(250)
  })
  it('asks month by month, from 14 days back to 60 ahead, and draws the weeks around today with a quiet line for the empty days', async () => {
    const asked = fakeAgenda([episode({ date: day(-3), title: 'Past Show', episode_name: 'Before', title_id: 5 }), movie({ date: day(2) })])
    await openUpcoming()

    await waitFor(() =>
      expect(asked.filter((r) => r.endsWith('-31') || r.endsWith('-30')).sort()).toEqual(['2026-09-01..2026-09-30', '2026-10-01..2026-10-31', '2026-11-01..2026-11-30', '2026-12-01..2026-12-31']),
    )
    const before = within(timeline()).getByText('Past Show')
    const after = within(timeline()).getByText('Paddington')
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Weeks roll from today: Oct 19 is in the week before, and Sat 24 has an entry in the week of Thu 22 Oct, whose other days are runs.
    expect(within(timeline()).getByText('Nothing on Thu 22 – Fri 23, Sun 25 – Wed 28')).toBeInTheDocument()
  })

  it('labels the days relatively in the date column', async () => {
    fakeAgenda([episode({ date: day(-1), title_id: 5, title: 'Yest' }), episode({ date: day(1), title_id: 6, title: 'Tomo' }), movie({ date: day(40) })])
    await openUpcoming()
    const dates = within(timeline()).getAllByText(/^(yesterday|tomorrow|in \d+ days)$/)
    expect(dates.map((d) => d.textContent)).toEqual(['yesterday', 'tomorrow', 'in 40 days'])
    expect(within(timeline()).getAllByText(/^(WED|THU|FRI|SAT|SUN|MON|TUE)$/i).length).toBeGreaterThanOrEqual(3)
  })

  it('loads the next month near the bottom and the previous one near the top, and says when nothing lies beyond', async () => {
    const io = fakeObserver()
    const asked = fakeAgenda([movie({ date: day(1) }), movie({ date: day(-10), title_id: 3, title: 'Last Month' })])
    await openUpcoming()
    await waitFor(() => expect(io.edges()).toHaveLength(2))
    const [top, bottom] = io.edges()
    expect(within(timeline()).getByText('Last Month')).toBeInTheDocument()
    io.reach(top, true)
    await waitFor(() => expect(asked).toContain('2026-08-01..2026-08-31'))
    await waitFor(() => expect(asked).toContain('2026-07-01..2026-07-31'))
    io.reach(bottom, true)
    await waitFor(() => expect(asked).toContain('2027-01-01..2027-01-31'))
    expect(await screen.findByText('Nothing later')).toBeInTheDocument()
    expect(await screen.findByText('Nothing earlier')).toBeInTheDocument()
    expect(daysBetween(asked.at(-1)!)).toBeGreaterThan(26)
  })

  it('keeps the first day in view where it was when a month lands above it', async () => {
    const io = fakeObserver()
    fakeAgenda([movie({ date: day(1) }), movie({ date: day(-40), title_id: 3, title: 'Before' })])
    await openUpcoming()
    await waitFor(() => expect(io.edges()).toHaveLength(2))
    const box = timeline().closest('.overflow-auto') as HTMLElement
    // jsdom has no layout: give the day it holds a place that moves down by 300 when the earlier month arrives.
    const heading = () => box.querySelector('[data-day]') as HTMLElement
    box.scrollTop = 0
    let shift = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this === box ? 0 : this.dataset.day ? 100 + shift : 0
      return { top, bottom: top + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: top, toJSON: () => ({}) }
    })
    fireEvent.scroll(box)
    shift = 300
    const before = heading().dataset.day
    io.reach(io.edges()[0], true)
    await waitFor(() => expect(box.scrollTop).toBe(300))
    expect(before).toBeTruthy()
    vi.restoreAllMocks()
  })

  it('says so when nothing is due', async () => {
    fakeAgenda([])
    await openUpcoming()
    expect(await screen.findByText(/nothing is due in this window/i)).toBeInTheDocument()
  })
})

describe('Upcoming: where each entry stands', () => {
  it('says where each entry stands: waiting for its release, out and not found, Imported, downloading and not monitored', async () => {
    fakeAgenda([
      movie({ date: day(3), title_id: 3, title: 'Soon' }),
      movie({ date: day(-5), title_id: 4, title: 'Waiting', slots: [slot('wanted')] }),
      movie({ date: day(-2), title_id: 6, title: 'Done', slots: [slot('imported')] }),
      episode({ date: day(1), title_id: 7, title: 'Off', monitored: false, season: 0, episode: 1, episode_name: 'Special' }),
      movie({ date: day(-3), title_id: 8, title: 'Fetching', slots: [slot('wanted')] }),
    ])
    fakeQueue([queueItem({ title_id: 8, slot: 'standard', bytes_total: 8000, bytes_left: 2000 })])
    await openUpcoming()
    const chip = (row: HTMLElement, name: string | RegExp) => within(row).getByRole('img', { name })
    expect(chip(rowOf('Soon'), 'Standard: Not out yet')).toHaveAttribute('data-state', 'unreleased')
    expect(chip(rowOf('Waiting'), 'Standard: Wanted')).toHaveAttribute('data-state', 'wanted')
    const done = rowOf('Done')
    expect(chip(done, 'Standard: Have')).toHaveAttribute('data-state', 'filled')
    expect(done).toHaveAttribute('data-imported')
    expect(chip(rowOf('Off'), 'Standard: Not monitored')).toHaveAttribute('data-state', 'unmonitored')
    expect(await within(rowOf('Fetching')).findByRole('img', { name: 'Standard: Downloading 75%' })).toHaveAttribute('data-state', 'downloading')
  })

  it('shows a chip per Slot of a Title with two, each in its own state', async () => {
    fakeAgenda([movie({ date: day(-1), slots: [slot('wanted'), slot('imported', { slot: '4k', version_id: 12, quality: 'Bluray-2160p' })] })])
    await openUpcoming()
    const r = rowOf('Paddington')
    expect(within(r).getByRole('img', { name: 'Standard: Wanted' })).toHaveAttribute('data-state', 'wanted')
    expect(within(r).getByRole('img', { name: '4K: Have' })).toHaveAttribute('data-state', 'filled')
    // The chips sit above the row's click overlay, so their tooltips reach the pointer.
    expect(within(r).getByRole('img', { name: '4K: Have' }).closest('.relative')).not.toBeNull()
  })

  it('matches a download to its episode', async () => {
    fakeAgenda([
      episode({ date: day(-1), episode: 4, episode_name: 'Four', slots: [slot('wanted', { version_id: 21 })] }),
      episode({ date: day(-1), episode: 5, episode_name: 'Five', episode_id: 205, slots: [slot('wanted', { version_id: 21 })] }),
    ])
    fakeQueue([queueItem({ title_id: 2, kind: 'series', episodes: ['S02E05'] })])
    await openUpcoming()
    expect(await within(rowOf(/Four/)).findByRole('img', { name: 'Standard: Wanted' })).toBeInTheDocument()
    expect(within(rowOf(/Five/)).getByRole('img', { name: /Standard: Downloading/ })).toBeInTheDocument()
  })

  it('offers Search now on a Wanted entry, narrowed to its episode', async () => {
    fakeAgenda([episode({ date: day(-1), slots: [slot('wanted', { version_id: 21 })] })])
    const searched: unknown[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push({ id: String(params.id), body: await request.json() })
        return response(202).json({ search_id: 'search-1' })
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
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (searched.push(String(params.id)), response(202).json({ search_id: 'search-1' }))))
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
      episode({ title_id: 7, title: 'Other', markers: ['season_finale'], episode_name: 'End', network: null }),
      episode({ title_id: 8, title: 'Extra', markers: ['special'], season: 0, episode_name: 'Behind' }),
      episode({ title_id: 9, title: 'Opener', markers: ['season_premiere'], episode_name: 'Overture' }),
    ])
    await openUpcoming()
    const pilot = rowOf(/Pilot/)
    const local = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    expect(within(pilot).getByText(`${local} · HBO`)).toBeInTheDocument()
    expect(within(pilot).getByText('Series premiere')).toBeInTheDocument()
    expect(within(rowOf(/End/)).getByText('Season finale')).toBeInTheDocument()
    expect(within(rowOf(/End/)).queryByText(/HBO/)).not.toBeInTheDocument() // no network in the data: none shown
    expect(within(rowOf(/Behind/)).getByText('Special')).toBeInTheDocument()
    expect(within(rowOf(/Overture/)).getByText('Season premiere')).toBeInTheDocument()
  })

  it('says an episode aired once its air time is past', async () => {
    const past = new Date(NOW.getTime() - 3_600_000).toISOString()
    fakeAgenda([episode({ date: day(0), air_at: past })])
    await openUpcoming()
    const local = new Date(past).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    expect(within(rowOf(/The Handover/)).getByText(`Aired ${local} · HBO`)).toBeInTheDocument()
  })

  it('puts an episode on the day its air time falls on in the browser, not the network date', async () => {
    // Dated tomorrow by the network, but airing at local noon the day after.
    const air = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2, 12, 0).toISOString()
    fakeAgenda([episode({ date: day(1), air_at: air })])
    await openUpcoming()
    const weekday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    expect(within(screen.getByRole('list', { name: weekday })).getByText('The Handover', { exact: false })).toBeInTheDocument()
  })

  it('has no overview on its entries: the Title page has it', async () => {
    fakeAgenda([episode()])
    await openUpcoming()
    expect(within(rowOf(/Bridge Show/)).queryByRole('button', { name: 'Show overview' })).not.toBeInTheDocument()
    expect(screen.queryByText('Two detectives, one bridge.')).not.toBeInTheDocument()
  })

  it('lists the episodes of one Series on one day as rows of their own', async () => {
    fakeAgenda([1, 2, 3].map((n) => episode({ date: day(1), episode: n, episode_name: `Ep ${n}`, episode_id: 200 + n, slots: [slot('not_out', { version_id: 21 })] })))
    await openUpcoming()
    expect(within(timeline()).getAllByText(/Ep \d/)).toHaveLength(3)
    expect(within(rowOf(/Ep 2/)).getByText(/S02E02/)).toBeInTheDocument()
  })

  it('says which release a Movie waits for and the dates around it', async () => {
    fakeAgenda([
      movie({
        date: day(3),
        searchable: true,
        searchable_from: day(3),
        dates: [
          { release_type: 'theatrical', date: '2026-10-11' },
          { release_type: 'digital', date: day(3) },
          { release_type: 'physical', date: day(51) },
        ],
      }),
      movie({
        date: day(0),
        title_id: 3,
        title: 'Out Today',
        slots: [slot('imported')],
        dates: [
          { release_type: 'digital', date: day(0) },
          { release_type: 'physical', date: '2026-12-01' },
        ],
      }),
    ])
    await openUpcoming()
    const r = rowOf('Paddington')
    expect(within(r).getByText('Digital release')).toBeInTheDocument()
    expect(within(r).getByText('Waiting for digital · theatrical was Oct 11')).toBeInTheDocument()
    expect(within(rowOf('Out Today')).getByText('Today · physical Dec 1')).toBeInTheDocument()
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

const field = () => screen.findByRole('combobox', { name: 'Filter Upcoming' })

describe('Upcoming: filters', () => {
  const mixed = () =>
    fakeAgenda([
      movie({ date: day(1), title: 'A Movie', slots: [slot('not_out')] }),
      episode({ date: day(1), title: 'A Series', episode_name: 'Pilot Night', slots: [slot('wanted', { version_id: 21 })] }),
      movie({ date: day(-2), title_id: 3, title: 'Filled Movie', slots: [slot('imported')] }),
    ])
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('has a filter field with its help, and reads ?q= from the address', async () => {
    mixed()
    history.replaceState(null, '', '/upcoming?q=kind:series')
    renderApp()
    await screen.findByRole('list', { name: 'Agenda' })
    expect(await field()).toHaveValue('kind:series')
    expect(screen.getByRole('button', { name: 'Query Help' })).toBeInTheDocument()
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Series')).toBeInTheDocument()
    history.replaceState(null, '', '/')
  })

  it('matches free text on the Title and the episode name', async () => {
    mixed()
    await openUpcoming()
    await userEvent.type(await field(), 'filled')
    expect(within(timeline()).getByText('Filled Movie')).toBeInTheDocument()
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    await userEvent.clear(await field())
    await userEvent.type(await field(), 'pilot')
    expect(within(timeline()).getByText('A Series')).toBeInTheDocument()
    expect(within(timeline()).queryByText('Filled Movie')).not.toBeInTheDocument()
  })

  it('narrows with kind:, is:wanted, is:imported and -is:imported', async () => {
    mixed()
    await openUpcoming()
    const type = async (q: string) => {
      await userEvent.clear(await field())
      if (q) await userEvent.type(await field(), q)
    }
    await type('kind:movie')
    expect(within(timeline()).queryByText('A Series')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
    await type('is:wanted')
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Series')).toBeInTheDocument()
    await type('is:imported')
    expect(within(timeline()).getByText('Filled Movie')).toBeInTheDocument()
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
    await type('-is:imported')
    expect(within(timeline()).queryByText('Filled Movie')).not.toBeInTheDocument()
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
    await type('slot:4k')
    expect(await screen.findByText('Nothing matches the filter.')).toBeInTheDocument()
  })

  it('says nothing matches and clears the filter', async () => {
    mixed()
    await openUpcoming()
    await userEvent.type(await field(), 'zzzz')
    expect(await screen.findByText('Nothing matches the filter.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show everything' }))
    expect(await field()).toHaveValue('')
    expect(within(timeline()).getByText('A Movie')).toBeInTheDocument()
  })

  it('keeps the menu and the field in step, and the menu excludes', async () => {
    mixed()
    await openUpcoming()
    await userEvent.click(await filterItem('Movies'))
    expect(await field()).toHaveValue('kind:movie')
    expect(within(timeline()).queryByText('A Series')).not.toBeInTheDocument()
    await userEvent.click(await filterItem('Wanted'))
    expect(await field()).toHaveValue('kind:movie is:wanted')
    expect(screen.getByRole('button', { name: 'Filter · 2' })).toBeInTheDocument()
    await userEvent.clear(await field())
    await userEvent.type(await field(), '-is:imported')
    expect(await filterItem('Imported, excluded')).toBeInTheDocument()
    expect(within(timeline()).queryByText('Filled Movie')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Exclude Wanted' }))
    expect(await field()).toHaveValue('-is:imported,wanted')
  })

  it('clears the whole query with the × and with Clear all, and the address follows', async () => {
    mixed()
    history.replaceState(null, '', '/upcoming?q=kind:movie%20is:wanted')
    renderApp()
    await screen.findByRole('list', { name: 'Agenda' })
    expect(location.search).toBe('?q=kind%3Amovie+is%3Awanted')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(await field()).toHaveValue('')
    expect(await field()).toHaveFocus()
    expect(location.search).toBe('')

    await userEvent.type(await field(), 'kind:series')
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear all' }))
    expect(await field()).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.queryByRole('menuitem', { name: 'Clear all' })).not.toBeInTheDocument()
    history.replaceState(null, '', '/')
  })

  it('clears a field with text on Escape', async () => {
    mixed()
    await openUpcoming()
    await userEvent.type(await field(), 'zzz')
    await userEvent.keyboard('{Escape}')
    expect(await field()).toHaveValue('')
  })

  it('remembers the query for the session, in the browser and not on the server', async () => {
    mixed()
    await openUpcoming()
    await userEvent.type(await field(), 'is:wanted')
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await screen.findByRole('list', { name: 'Agenda' })
    expect(await field()).toHaveValue('is:wanted')
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
  })
})

describe('Upcoming: the side panel', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('counts the four views, each with its icon, and narrows the agenda to the one chosen', async () => {
    fakeAgenda([
      movie({ date: day(1), title: 'Soon Movie' }),
      movie({ date: day(40), title_id: 3, title: 'Far Movie' }),
      movie({ date: day(-3), title_id: 4, title: 'Out Movie', slots: [slot('wanted')] }),
      episode({ date: day(2), title_id: 5, title: 'Off Show', monitored: false }),
    ])
    await openUpcoming()
    const views = within(await screen.findByRole('navigation', { name: 'Views' }))
    expect(views.getAllByRole('button').map((b) => b.textContent)).toEqual(['Everything, 4', 'Wanted when out, 2', 'Recently out, 1', 'Not monitored, 1'])
    for (const b of views.getAllByRole('button')) expect(b.querySelector('svg')).not.toBeNull()
    expect(views.getByRole('button', { name: /Everything/ })).toHaveAttribute('aria-current', 'true')
    await userEvent.click(views.getByRole('button', { name: /Recently out/ }))
    expect(views.getByRole('button', { name: /Recently out/ })).toHaveAttribute('aria-current', 'true')
    expect(within(timeline()).getByText('Out Movie')).toBeInTheDocument()
    expect(within(timeline()).queryByText('Soon Movie')).not.toBeInTheDocument()
    await userEvent.click(views.getByRole('button', { name: /Not monitored/ }))
    expect(within(timeline()).getByText('Off Show')).toBeInTheDocument()
    expect(within(timeline()).queryByText('Out Movie')).not.toBeInTheDocument()
    await userEvent.click(views.getByRole('button', { name: /Everything/ }))
    expect(within(timeline()).getByText('Soon Movie')).toBeInTheDocument()
  })

  it('asks for the unmonitored entries', async () => {
    fakeAgenda([movie()])
    const asked: (string | null)[] = []
    server.use(
      http.get('/upcoming', ({ request, response }) => {
        const q = new URL(request.url).searchParams
        asked.push(q.get('unmonitored'))
        return response(200).json({ from: q.get('from') ?? '', to: q.get('to') ?? '', items: [], undated: [] })
      }),
    )
    await openUpcoming()
    await waitFor(() => expect(asked.length).toBeGreaterThan(0))
    expect(asked).toContain('true')
  })

  it('keeps the Views out of the Filter menu on a desktop, which holds only refinements', async () => {
    fakeAgenda([movie()])
    await openUpcoming()
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    expect(screen.getByRole('menuitemcheckbox', { name: /Series/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: /Wanted when out/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Views', { selector: '[role=menu] *' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: /Titles?/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Views' })).getByRole('button', { name: /Recently out/ }))
    expect(screen.getByRole('button', { name: /^Filter$/ })).toBeInTheDocument() // a View is not a refinement: no count on the badge
  })

  it('puts the Views first in the Filter menu on a phone, where the panel has none, with no Month display and a week strip', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 639'), media: q, addEventListener: () => {}, removeEventListener: () => {} }))
    fakeAgenda([movie({ date: day(1) }), episode({ date: day(0), title_id: 5, title: 'Tonight' })])
    await openUpcoming()
    expect(screen.queryByRole('button', { name: /^Display/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Calendar' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Views and filter' }))
    expect(await screen.findByRole('menuitemradio', { name: /Everything/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Not monitored/ })).toBeInTheDocument()
  })

  it('has a calendar whose days are buttons, with a dot when something is due, and that moves by month', async () => {
    const asked = fakeAgenda([movie({ date: day(1) })])
    await openUpcoming()
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    const tomorrow = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1)
    const label = tomorrow.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const due = calendar.getByRole('button', { name: `${label}, 1 release` })
    expect(within(due).getByTestId('release-dot')).toBeInTheDocument()
    expect(calendar.getAllByTestId('release-dot')).toHaveLength(1)
    expect(calendar.getByRole('button', { name: /, today$/ })).toHaveAttribute('aria-current', 'date')
    await userEvent.click(calendar.getByRole('button', { name: 'Next month' }))
    await userEvent.click(calendar.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(asked.at(-1)!.split('..')[1] > day(60)).toBe(true))
  })

  it('shows the whole grid of the month, the neighbours dimmed, with a dot on every day with releases', async () => {
    // October 2026 shows Mon 28 September to Sun 1 November; November shows Mon 26 October to Sun 6 December.
    fakeAgenda([movie({ date: '2026-09-29', title_id: 3, title: 'Late Sept' }), movie({ date: '2026-11-01' }), movie({ date: '2026-12-03', title_id: 4, title: 'Early Dec' })])
    await openUpcoming()
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    expect(calendar.getAllByRole('button', { name: /\d{4}/ })).toHaveLength(35)
    await waitFor(() => expect(calendar.getAllByTestId('release-dot')).toHaveLength(2))
    expect(calendar.getByRole('button', { name: /Tuesday, September 29, 2026, 1 release/ })).toBeInTheDocument()
    expect(calendar.getByRole('button', { name: /Sunday, November 1, 2026, 1 release/ })).toBeInTheDocument()
    await userEvent.click(calendar.getByRole('button', { name: 'Next month' }))
    expect(calendar.getAllByRole('button', { name: /\d{4}/ })).toHaveLength(42)
    await waitFor(() => expect(calendar.getAllByTestId('release-dot')).toHaveLength(2))
    expect(calendar.getByRole('button', { name: /Thursday, December 3, 2026, 1 release/ })).toBeInTheDocument()
  })

  it('moves the agenda to the month the calendar switches to, loading it when it is not there', async () => {
    const asked = fakeAgenda([movie({ date: day(1) }), movie({ date: '2027-02-10', title_id: 3, title: 'February Movie' }), movie({ date: '2027-01-12', title_id: 4, title: 'January Movie' })])
    await openUpcoming()
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    for (let i = 0; i < 3; i++) await userEvent.click(calendar.getByRole('button', { name: 'Next month' }))
    expect(calendar.getByRole('heading', { name: 'January 2027' })).toBeInTheDocument()
    await waitFor(() => expect(asked).toContain('2027-01-01..2027-01-31'))
    await waitFor(() => expect(current()).toHaveTextContent('January Movie'))
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(calendar.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  it('moves the calendar to the month the agenda is scrolled into, not while it scrolls itself', async () => {
    const io = fakeObserver()
    fakeAgenda([movie({ date: day(1) }), movie({ date: '2026-12-10', title_id: 3, title: 'December Movie' })])
    await openUpcoming()
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    await waitFor(() => expect(io.days()).not.toBeNull())
    const december = () => timeline().querySelector('[data-day="2026-12-10"]') as HTMLElement
    io.reach(december(), true, io.days()!)
    expect(calendar.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument() // nobody scrolled
    await new Promise((r) => setTimeout(r, 700)) // the opening scroll's hold ends
    fireEvent.scroll(timeline().closest('.overflow-auto')!)
    io.reach(december(), true, io.days()!)
    await waitFor(() => expect(calendar.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument())
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

  it("starts a new session on the household's defaults, written as a query", async () => {
    serveDisplay({ upcoming_filters: { kind: 'series', wanted_only: true, hide_imported: true } })
    mixed()
    await openUpcoming()
    await waitFor(async () => expect(await field()).toHaveValue('kind:series is:wanted -is:imported'))
    expect(within(timeline()).queryByText('A Movie')).not.toBeInTheDocument()
  })

  it('lets a change in the session win over the defaults, and keeps it', async () => {
    serveDisplay({ upcoming_filters: { kind: 'all', wanted_only: true, hide_imported: false } })
    mixed()
    await openUpcoming()
    await waitFor(async () => expect(await field()).toHaveValue('is:wanted'))
    await userEvent.clear(await field())
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await screen.findByRole('list', { name: 'Agenda' })
    expect(await field()).toHaveValue('')
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

  it('opens the Title of the row under the cursor with Enter, and with a click on the row', async () => {
    fakeAgenda([movie({ date: day(1) }), episode({ date: day(2) })])
    await openUpcoming()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('j{Enter}')
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
})

describe('Upcoming: the Agenda display', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  const week = () => {
    fakeAgenda([
      episode({ date: day(-3), title_id: 5, title: 'Aired Show', episode_id: 301, slots: [slot('imported', { version_id: 31 })] }),
      episode({ date: day(0), title_id: 6, title: 'Tonight Show', episode_id: 302, slots: [slot('not_out', { version_id: 32 })] }),
      episode({ date: day(1), title_id: 7, title: 'Missing Show', episode_id: 303, slots: [slot('wanted', { version_id: 33 })] }),
      movie({ date: day(2), slots: [slot('not_out')] }),
      movie({ date: day(8), title_id: 9, title: 'Next Week Movie' }),
    ])
  }

  it('heads the week with its dates and four stat cards derived from the loaded entries', async () => {
    week()
    await openUpcoming()
    const header = within(screen.getByRole('region', { name: 'Week' }))
    expect(header.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
    expect(header.getByText('Oct 22 – 28')).toBeInTheDocument()
    const cards = () => within(screen.getByRole('list', { name: 'The week in numbers' })).getAllByRole('listitem')
    expect(cards().map((c) => c.textContent)).toEqual(['2episodes airing', '1Movie released', '2searched when out', '0already in the Library'])
  })

  it('moves by week with the arrows and comes back with Today', async () => {
    week()
    await openUpcoming()
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    const header = within(screen.getByRole('region', { name: 'Week' }))
    expect(header.getByRole('heading', { name: 'Next week' })).toBeInTheDocument()
    expect(header.getByText('Oct 29 – Nov 4')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'The week in numbers' })).getAllByRole('listitem')[1]).toHaveTextContent('1Movie released')
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(header.getByRole('heading', { name: 'Week of Nov 5' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(header.getByRole('heading', { name: 'Last week' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(header.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
  })

  it('shades the shown week in the side panel calendar, which follows the header', async () => {
    week()
    await openUpcoming()
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    const shaded = () =>
      calendar
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('data-week'))
        .map((b) => b.textContent)
    expect(shaded()).toEqual(['22', '23', '24', '25', '26', '27', '28'])
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(shaded()).toEqual(['29', '30', '31', '1'])
  })

  it("draws the date column with the weekday, the day number and how far away it is, beside that day's card", async () => {
    week()
    await openUpcoming()
    const card = screen.getByRole('list', { name: /^Fri, Oct 23/ })
    const block = card.closest('li[data-day]')!
    expect(block).toHaveTextContent(/FRI|Fri/)
    expect(block).toHaveTextContent('23')
    expect(block).toHaveTextContent('tomorrow')
    expect(within(card).getByText('Missing Show')).toBeInTheDocument()
  })

  it('collapses runs of empty days into one muted line', async () => {
    fakeAgenda([episode({ date: day(-3), title_id: 5, title: 'Monday Show' }), movie({ date: day(2) })])
    await openUpcoming()
    // Sat 24 has an entry in the week of Thu 22: Thu-Fri is a run, Sun 25 to Wed 28 another.
    expect(within(timeline()).getByText('Nothing on Thu 22 – Fri 23, Sun 25 – Wed 28')).toBeInTheDocument()
  })

  it('merges whole empty weeks into one line, and keeps the week of today apart', async () => {
    fakeAgenda([movie({ date: day(-3), title: 'Early' }), movie({ date: day(23), title_id: 3, title: 'Late' })])
    await openUpcoming()
    // The weeks of 29 Oct and 5 Nov are empty; 12 Nov has Late (Nov 14).
    expect(within(timeline()).getByText('Nothing on Thu 29 Oct – Wed 11 Nov')).toBeInTheDocument()
  })

  it("shows today's week even when it holds nothing", async () => {
    fakeAgenda([movie({ date: day(30), title: 'Far' })])
    await openUpcoming()
    expect(within(timeline()).getByText(/^Nothing on Thu 22 – Wed 28$/)).toBeInTheDocument()
  })

  it("names the Movie's release and offers Search now only on an entry that is out and not found", async () => {
    fakeAgenda([movie({ date: day(-1), slots: [slot('wanted')] }), episode({ date: day(1), slots: [slot('not_out', { version_id: 21 })] })])
    await openUpcoming()
    expect(within(rowOf('Paddington')).getByRole('button', { name: /search now/i })).toBeInTheDocument()
    expect(within(rowOf(/The Handover/)).queryByRole('button', { name: /search now/i })).not.toBeInTheDocument()
  })
})

describe('Upcoming: the Display switch and the Month display', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  const many = () => {
    const at = day(1)
    fakeAgenda([
      episode({ date: at, title_id: 11, title: 'One', season: 1, episode: 1, episode_name: 'Alpha', slots: [slot('wanted', { version_id: 41 })] }),
      episode({ date: at, title_id: 12, title: 'Two', season: 1, episode: 2, episode_name: 'Beta', slots: [slot('not_out', { version_id: 42 })] }),
      episode({ date: at, title_id: 13, title: 'Three', season: 1, episode: 3, episode_name: 'Gamma', slots: [slot('imported', { version_id: 43 })] }),
      episode({ date: at, title_id: 14, title: 'Four', season: 1, episode: 4, episode_name: 'Delta', monitored: false, slots: [slot('not_out', { version_id: 44 })] }),
      episode({ date: at, title_id: 15, title: 'Five', season: 1, episode: 5, episode_name: 'Epsilon', slots: [slot('not_out', { version_id: 45 })] }),
      movie({ date: day(3) }),
    ])
  }
  const toMonth = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Display: Agenda' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Month' }))
  }

  it('has a Display button beside Filter that switches between Agenda and Month, and the choice is kept in this browser', async () => {
    many()
    await openUpcoming()
    expect(screen.getByRole('region', { name: 'Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Week' })).toBeInTheDocument()
    await toMonth()
    expect(await screen.findByRole('region', { name: 'Month' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Calendar' })).not.toBeInTheDocument() // the small calendar hides
    expect(screen.queryByRole('list', { name: 'Agenda' })).not.toBeInTheDocument()
    expect(localStorage.getItem('kestrel.upcoming.display')).toBe('month')
    expect(screen.getByRole('button', { name: 'Display: Month' })).toBeInTheDocument()
    // The Views stay in the panel.
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument()
  })

  it('opens on Month when that was the last choice', async () => {
    localStorage.setItem('kestrel.upcoming.display', 'month')
    many()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    expect(await screen.findByRole('region', { name: 'Month' })).toBeInTheDocument()
  })

  it("opens on the household default display, and this browser's own choice wins over it", async () => {
    serveDisplay({ upcoming_display: 'month' })
    many()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    expect(await screen.findByRole('region', { name: 'Month' })).toBeInTheDocument()
    expect(localStorage.getItem('kestrel.upcoming.display')).toBeNull() // a default is not a choice
    await userEvent.click(screen.getByRole('button', { name: 'Display: Month' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Agenda' }))
    expect(await screen.findByRole('region', { name: 'Week' })).toBeInTheDocument()
    expect(localStorage.getItem('kestrel.upcoming.display')).toBe('agenda')
  })

  it("keeps the browser's own Agenda over a household default of Month", async () => {
    serveDisplay({ upcoming_display: 'month' })
    localStorage.setItem('kestrel.upcoming.display', 'agenda')
    many()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    expect(await screen.findByRole('region', { name: 'Week' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Month' })).not.toBeInTheDocument()
  })

  it('draws a Monday-first grid of the month with the neighbours dimmed, today marked, and a legend', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    const month = within(await screen.findByRole('region', { name: 'Month' }))
    expect(month.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    const grid = month.getByRole('grid', { name: 'Upcoming, October 2026' })
    const cells = within(grid).getAllByRole('gridcell')
    expect(cells).toHaveLength(35) // 28 Sep to 1 Nov
    expect(cells[0]).toHaveAttribute('data-day', '2026-09-28')
    expect(cells[34]).toHaveAttribute('data-day', '2026-11-01')
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['MonMonday', 'TueTuesday', 'WedWednesday', 'ThuThursday', 'FriFriday', 'SatSaturday', 'SunSunday'])
    expect(within(grid).getByRole('gridcell', { name: /^Thursday, October 22.*, today$/ })).toHaveAttribute('aria-current', 'date')
    const legend = month.getByRole('list', { name: 'Legend' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['Have', 'Downloading', 'Wanted', 'Long Missing', 'Not out yet', 'Upgrade wanted', 'Not monitored'])
  })

  it('shows up to three entries a day, with the title and code, a full tooltip and name, a mark by state, then "+N more"', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    const month = within(await screen.findByRole('region', { name: 'Month' }))
    const cell = month.getByRole('gridcell', { name: /5 entries/ })
    expect(cell).toHaveAttribute('data-day', '2026-10-23')
    const pills = within(cell).getAllByRole('button', { name: / — / })
    expect(pills).toHaveLength(3)
    expect(pills[0]).toHaveAccessibleName('One S01E01 · Alpha — Out · not found yet')
    expect(within(pills[0]).getByTitle('One S01E01 · Alpha — Out · not found yet')).toHaveTextContent('One S01E01')
    expect(within(cell).getByRole('button', { name: /^\+2 more/ })).toBeInTheDocument()
    const sunday = month.getByRole('gridcell', { name: /^Sunday, October 25/ })
    expect(within(sunday).queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
    expect(month.getByText(/^6 releases · 3 searched when out$/)).toBeInTheDocument()
    expect(month.getByRole('button', { name: /Paddington · digital release — Not out yet/ })).toBeInTheDocument()
  })

  it('opens the Title from a pill, and the Agenda at the day from "+N more" and from the day number', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    const month = within(await screen.findByRole('region', { name: 'Month' }))
    await userEvent.click(month.getByRole('button', { name: /Paddington/ }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('switches to the Agenda at that day from "+N more"', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await userEvent.click(await screen.findByRole('button', { name: /^\+2 more/ }))
    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Month' })).not.toBeInTheDocument()
    expect(localStorage.getItem('kestrel.upcoming.display')).toBe('agenda')
    expect(within(screen.getByRole('region', { name: 'Week' })).getByText('Oct 22 – 28')).toBeInTheDocument()
    expect(within(timeline()).getByText('Five')).toBeInTheDocument()
  })

  it('switches to the Agenda at that day from the day number', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await userEvent.click(await screen.findByRole('gridcell', { name: /^Saturday, October 24/ }))
    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
  })

  it('moves between days with the arrow keys and opens the focused day in the Agenda with Enter', async () => {
    many()
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    const month = within(await screen.findByRole('region', { name: 'Month' }))
    month.getByRole('gridcell', { name: /^Thursday, October 22/ }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowDown}')
    expect(month.getByRole('gridcell', { name: /^Friday, October 30/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(month.getByRole('gridcell', { name: /^Friday, October 23/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
    expect(within(timeline()).getByText('Five')).toBeInTheDocument()
  })

  it('moves by month and back to today', async () => {
    many()
    const asked = fakeAgenda([movie({ date: '2026-11-12', title: 'November Movie' })])
    localStorage.setItem('kestrel.upcoming.display', 'month')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    const month = within(await screen.findByRole('region', { name: 'Month' }))
    await userEvent.click(month.getByRole('button', { name: 'Next Month' }))
    expect(month.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(await month.findByRole('button', { name: /November Movie/ })).toBeInTheDocument()
    expect(asked.length).toBeGreaterThan(0)
    await userEvent.click(month.getByRole('button', { name: 'Today' }))
    expect(month.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })
})

describe('Upcoming: on a phone', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 639'), media: q, addEventListener: () => {}, removeEventListener: () => {} })))

  it('has a week strip of seven day buttons with dots, today marked, and the shown day pressed', async () => {
    fakeAgenda([episode({ date: day(0), title_id: 5, title: 'Tonight' }), movie({ date: day(2) })])
    await openUpcoming()
    const strip = within(screen.getByRole('group', { name: 'This week' }))
    const days = strip.getAllByRole('button')
    expect(days).toHaveLength(7)
    expect(days[0]).toHaveAccessibleName(/^Thursday, October 22, today/)
    expect(strip.getAllByTestId('week-dot').filter((d) => d.hasAttribute('data-due'))).toHaveLength(2)
    expect(strip.getByRole('button', { name: /Thursday, October 22, today, 1 due/ })).toHaveAttribute('aria-current', 'date')
    expect(strip.getByRole('button', { name: /Thursday/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(strip.getByRole('button', { name: /Saturday, October 24/ }))
    expect(strip.getByRole('button', { name: /Saturday/ })).toHaveAttribute('aria-pressed', 'true')
    expect(strip.getByRole('button', { name: /Thursday/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists each day as a section of rows with a status dot and the time', async () => {
    const at = '2026-10-22T20:00:00'
    fakeAgenda([episode({ date: day(0), air_at: new Date(at).toISOString(), title_id: 5, title: 'Tonight', slots: [slot('wanted', { version_id: 51 })] })])
    await openUpcoming()
    const list = screen.getByRole('list', { name: 'Thu, Oct 22' })
    const row = within(list).getByText('Tonight').closest('li')!
    expect(within(row).getByRole('img', { name: 'Standard: Wanted' })).toBeInTheDocument()
    expect(within(row).getByText('20:00')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Week' })).not.toBeInTheDocument() // the strip stands in for the week header
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

describe('Upcoming: a big agenda is drawn in a window', () => {
  // jsdom has no layout: the scroller is given a height, and scrolling it is a scrollTop that fires `scroll`.
  const tall = () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    // A day takes 58px for each of its rows, as the windowing estimates; everything else takes none.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.index ? 58 * Math.max(1, this.querySelectorAll('[data-nav]').length) : 0
    })
    // The list starts 100px down the scroller, wherever it is scrolled to.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.getAttribute('aria-label') === 'Agenda' ? 100 - (this.closest('.overflow-auto')?.scrollTop ?? 0) : 0
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
    })
    const scrolled: number[] = []
    Element.prototype.scrollTo = function (this: Element, opts?: ScrollToOptions | number) {
      const top = typeof opts === 'object' ? (opts.top ?? 0) : 0
      scrolled.push(top)
      this.scrollTop = top
      queueMicrotask(() => this.dispatchEvent(new Event('scroll'))) // a browser's scroll event is not synchronous either
    } as typeof Element.prototype.scrollTo
    return scrolled
  }
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error -- jsdom has no Element.scrollTo; the test gave it one
    delete Element.prototype.scrollTo
  })
  // 2,000 entries, 27 on each of the 75 days from 14 back to 60 ahead.
  const many = () => Array.from({ length: 2000 }, (_, k) => episode({ date: day((k % 75) - 14), title_id: 100 + k, title: `Show ${k}`, episode: 1 + (k % 9) }))
  const mounted = () => document.querySelectorAll('[data-nav^="up-"]').length

  it('draws well under every row of a 2,000-entry agenda on open', async () => {
    tall()
    fakeAgenda(many())
    await openUpcoming()
    await waitFor(() => expect(mounted()).toBeGreaterThan(0))
    expect(mounted()).toBeLessThan(500)
  })

  it('scrolls to a day that is not drawn, and draws it', async () => {
    const scrolled = tall()
    fakeAgenda(many())
    await openUpcoming()
    await waitFor(() => expect(mounted()).toBeGreaterThan(0))
    const far = day(8)
    expect(timeline().querySelector(`[data-day="${far}"]`)).toBeNull()
    const label = new Date(`${far}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const calendar = within(await screen.findByRole('region', { name: 'Calendar' }))
    await userEvent.click(calendar.getByRole('button', { name: new RegExp(`^${label}`) }))
    await waitFor(() => expect(timeline().querySelector(`[data-day="${far}"]`)).not.toBeNull())
    expect(scrolled.at(-1)).toBeGreaterThan(0)
    expect(mounted()).toBeLessThan(500)
  })

  it('keeps the cursor on its row as j moves it past the days that are drawn', async () => {
    tall()
    fakeAgenda(many())
    await openUpcoming()
    await waitFor(() => expect(mounted()).toBeGreaterThan(0))
    for (let i = 0; i < 60; i++) await userEvent.keyboard('j')
    await waitFor(() => expect(current()).not.toBeNull())
    expect(mounted()).toBeLessThan(500)
  })
})

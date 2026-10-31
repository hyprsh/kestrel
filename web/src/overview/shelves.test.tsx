import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { dayLabel } from '../upcoming/state'
import { fakeLibrary, row } from '../test/library'
import { fitCells } from './Shelf'

type Recent = components['schemas']['RecentItem']
type Upcoming = components['schemas']['UpcomingItem']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const recent = (n: number, over: Partial<Recent> = {}): Recent => ({
  title_id: 40 + n,
  title: `Imported ${n}`,
  year: 2026,
  kind: 'movie',
  has_poster: n % 2 === 0,
  slot: 'standard',
  release_name: `Imported.${n}-GRP`,
  score: 100,
  score_delta: null,
  files: 1,
  is_upgrade: false,
  imported_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  ...over,
})
const fakeRecent = (items: Recent[], total = items.length) => server.use(http.get('/recent', ({ response }) => response(200).json({ items, total })))

const upcoming = (n: number, over: Partial<Upcoming> = {}): Upcoming => ({
  date: dayString(1),
  kind: 'movie',
  title_id: 20 + n,
  title: `Movie ${n}`,
  year: 2026,
  release_type: 'digital',
  season: null,
  episode: null,
  episode_name: null,
  searchable_from: null,
  released: true,
  has_poster: true,
  ...over,
})
const fakeUpcoming = (items: Upcoming[]) => server.use(http.get('/upcoming', ({ response }) => response(200).json({ from: dayString(), to: dayString(6), items })))

const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i + 1))
const url = () => location.pathname + location.search

beforeEach(() => history.replaceState(null, '', '/'))

describe('fitCells', () => {
  it('fits eight posters on a desktop row, fewer as the width shrinks, and at least one', () => {
    expect(fitCells(1200)).toBe(8)
    expect(fitCells(600)).toBe(5)
    expect(fitCells(358)).toBe(3)
    expect(fitCells(40)).toBe(1)
  })
})

describe('Recently added shelf', () => {
  it('is one row of up to eight posters with the name and the Slot and age under each, the week count in the heading', async () => {
    fakeRecent(
      many(10, (n) => recent(n)),
      14,
    )
    renderApp()

    const section = await screen.findByRole('region', { name: 'Recently added · 14' })
    const posters = await within(section).findAllByRole('listitem')
    expect(posters).toHaveLength(8)
    expect(posters[0]).toHaveTextContent('Imported 1')
    expect(posters[0]).toHaveTextContent('Standard · 3 h ago')
    expect(posters[1].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/42/poster'))
    expect(posters[0].querySelector('[data-poster]')).toBeInTheDocument()
    expect(posters[0].querySelector('img')).not.toBeInTheDocument()
  })

  it('opens the Title from its poster', async () => {
    fakeRecent([recent(1)])
    fakeLibrary([row(41, 'Imported 1', 'Imported 1')])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Recently added/ })
    await userEvent.click(await within(section).findByRole('button', { name: /Imported 1/ }))

    expect(await screen.findByRole('region', { name: /imported 1/i })).toBeInTheDocument()
  })

  it('links its heading to the Library', async () => {
    fakeRecent([recent(1)])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Recently added/ })
    await userEvent.click(within(section).getByRole('button', { name: 'Library →' }))

    expect(url()).toBe('/library')
  })

  it('says so in one line when nothing has been imported', async () => {
    fakeRecent([])
    renderApp()

    expect(await screen.findByText('Nothing has been imported yet.')).toBeInTheDocument()
  })
})

describe('Coming this week shelf', () => {
  it('is one row of up to eight posters with the name and the day under each', async () => {
    fakeUpcoming(many(10, (n) => upcoming(n)))
    renderApp()

    const section = await screen.findByRole('region', { name: 'Coming this week · 10' })
    const posters = await within(section).findAllByRole('listitem')
    expect(posters).toHaveLength(8)
    expect(posters[0]).toHaveTextContent('Movie 1')
    expect(posters[0]).toHaveTextContent(dayLabel(dayString(1)))
    expect(posters[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/21/poster'))
  })

  it('names the episode of a Series under its poster', async () => {
    fakeUpcoming([upcoming(1, { kind: 'series', title: 'Severance', season: 2, episode: 4, episode_name: 'Woe' })])
    renderApp()

    const [poster] = await within(await screen.findByRole('region', { name: /^Coming this week/ })).findAllByRole('listitem')
    expect(poster).toHaveTextContent('Severance')
    expect(poster).toHaveTextContent('S02E04')
  })

  it('links its heading to Upcoming', async () => {
    fakeUpcoming([upcoming(1)])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Coming this week/ })
    await userEvent.click(within(section).getByRole('button', { name: 'Upcoming →' }))

    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
    expect(location.pathname).toBe('/upcoming')
  })

  it('says so in one line when nothing is due', async () => {
    fakeUpcoming([])
    renderApp()

    expect(await screen.findByText('Nothing is due in the next 7 days.')).toBeInTheDocument()
  })
})

describe('shelves at a narrow width', () => {
  let width = 1200
  let notify: (() => void)[] = []
  beforeEach(() => {
    width = 1200
    notify = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: ResizeObserverCallback
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb
        }
        observe() {
          const fire = () => this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
          notify.push(fire)
          fire()
        }
        disconnect() {}
        unobserve() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows fewer posters on a phone and more again when the width grows', async () => {
    width = 358
    fakeRecent(many(8, (n) => recent(n)))
    renderApp()

    const section = await screen.findByRole('region', { name: /^Recently added/ })
    expect(await within(section).findAllByRole('listitem')).toHaveLength(3)

    width = 1200
    act(() => notify.forEach((fire) => fire()))
    expect(await within(section).findAllByRole('listitem')).toHaveLength(8)
  })
})

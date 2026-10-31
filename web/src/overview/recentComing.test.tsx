import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { dayLabel } from '../upcoming/state'
import { fakeLibrary, row } from '../test/library'

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

describe('Recently added', () => {
  it('is up to five rows with the poster, the name and the Slot and age, the week count in the heading', async () => {
    fakeRecent(
      many(10, (n) => recent(n)),
      14,
    )
    renderApp()

    const section = await screen.findByRole('region', { name: 'Recently added · 14' })
    const posters = await within(section).findAllByRole('listitem')
    expect(posters).toHaveLength(5)
    expect(posters[0]).toHaveTextContent('Imported 1')
    expect(posters[0]).toHaveTextContent('Standard · 3 h ago')
    expect(posters[1].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/42/poster'))
    expect(posters[0].querySelector('[data-poster]')).toBeInTheDocument()
    expect(posters[0].querySelector('img')).not.toBeInTheDocument()
  })

  it('opens the Title from its row', async () => {
    fakeRecent([recent(1)])
    fakeLibrary([row(41, 'Imported 1', 'Imported 1')])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Recently added/ })
    await userEvent.click(await within(section).findByRole('button', { name: /Imported 1/ }))

    expect(await screen.findByRole('region', { name: /imported 1/i })).toBeInTheDocument()
  })

  it('links to the Library from the pill below its rows', async () => {
    fakeRecent([recent(1)])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Recently added/ })
    await userEvent.click(await within(section).findByRole('button', { name: 'Library →' }))

    expect(url()).toBe('/library')
  })

  it('says so in one line when nothing has been imported', async () => {
    fakeRecent([])
    renderApp()

    expect(await screen.findByText('Nothing has been imported yet.')).toBeInTheDocument()
  })
})

describe('Coming this week', () => {
  it('is up to five rows with the poster, the name and the day', async () => {
    fakeUpcoming(many(10, (n) => upcoming(n)))
    renderApp()

    const section = await screen.findByRole('region', { name: 'Coming this week · 10' })
    const posters = await within(section).findAllByRole('listitem')
    expect(posters).toHaveLength(5)
    expect(posters[0]).toHaveTextContent('Movie 1')
    expect(posters[0]).toHaveTextContent(dayLabel(dayString(1)))
    expect(posters[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/21/poster'))
  })

  it('names the episode of a Series', async () => {
    fakeUpcoming([upcoming(1, { kind: 'series', title: 'Severance', season: 2, episode: 4, episode_name: 'Woe' })])
    renderApp()

    const [poster] = await within(await screen.findByRole('region', { name: /^Coming this week/ })).findAllByRole('listitem')
    expect(poster).toHaveTextContent('Severance')
    expect(poster).toHaveTextContent('S02E04')
  })

  it('links to Upcoming from the pill below its rows', async () => {
    fakeUpcoming([upcoming(1)])
    renderApp()

    const section = await screen.findByRole('region', { name: /^Coming this week/ })
    await userEvent.click(await within(section).findByRole('button', { name: 'Upcoming →' }))

    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
    expect(location.pathname).toBe('/upcoming')
  })

  it('says so in one line when nothing is due', async () => {
    fakeUpcoming([])
    renderApp()

    expect(await screen.findByText('Nothing is due in the next 7 days.')).toBeInTheDocument()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Upcoming = components['schemas']['UpcomingItem']
type Recent = components['schemas']['RecentItem']

const movie = (over: Partial<Upcoming> = {}): Upcoming => ({
  date: '2026-10-20',
  kind: 'movie',
  title_id: 1,
  title: 'Paddington',
  year: 2014,
  release_type: 'digital',
  season: null,
  episode: null,
  episode_name: null,
  searchable_from: '2026-10-20',
  released: false,
  ...over,
})

const episode = (over: Partial<Upcoming> = {}): Upcoming => ({
  date: '2026-10-20',
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
  ...over,
})

const recent = (over: Partial<Recent> = {}): Recent => ({
  title_id: 1,
  title: 'Paddington',
  year: 2014,
  kind: 'movie',
  slot: 'standard',
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  score: 120,
  score_delta: null,
  files: 1,
  is_upgrade: false,
  imported_at: '2026-10-16T10:00:00Z',
  ...over,
})

function fakeAgenda(items: Upcoming[], imports: Recent[] = []) {
  const asked: string[] = []
  fakeLibrary([row(1, 'Paddington', 'Paddington'), row(2, 'Bridge Show', 'Bridge Show', { kind: 'series' })])
  server.use(
    http.get('/upcoming', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('from')}..${q.get('to')}`)
      return response(200).json({ from: q.get('from') ?? '', to: q.get('to') ?? '', items })
    }),
    http.get('/recent', ({ response }) => response(200).json({ items: imports, total: imports.length })),
  )
  return asked
}

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const daysBetween = (range: string) => {
  const [from, to] = range.split('..').map((d) => Date.parse(`${d}T00:00:00Z`))
  return (to - from) / 86_400_000
}

describe('Upcoming', () => {
  it('lists the agenda for today to 30 days on with the unreleased note and episode codes', async () => {
    const asked = fakeAgenda([movie(), episode(), movie({ date: '2026-10-25', release_type: 'physical', title_id: 3, title: 'Heat', searchable_from: null })])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))

    const agenda = await screen.findByRole('list', { name: 'Agenda' })
    const rows = within(agenda).getAllByRole('listitem', {})
    const text = rows.map((r) => r.textContent)
    expect(text.some((t) => t?.includes('Paddington') && t.includes('Digital') && t.includes('searchable from 2026-10-20'))).toBe(true)
    expect(text.some((t) => t?.includes('Bridge Show') && t.includes('S02E04') && t.includes('The Handover'))).toBe(true)
    expect(text.some((t) => t?.includes('Heat') && t.includes('no search date yet'))).toBe(true)
    expect(daysBetween(asked.at(-1)!)).toBe(30)
  })

  it('moves with j and k and opens the Title with Enter', async () => {
    fakeAgenda([movie(), episode({ date: '2026-10-21' })])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    await screen.findByText(/The Handover/)
    ;(document.activeElement as HTMLElement).blur() // Enter on the focused rail button would press it

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Bridge Show')
    await userEvent.keyboard('{ArrowUp}')
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('says so when nothing is due', async () => {
    fakeAgenda([])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Upcoming' }))
    expect(await screen.findByText(/nothing is due in the next 30 days/i)).toBeInTheDocument()
  })
})

describe('Overview: Coming this week and Recently added', () => {
  it('shows the next 7 days and the latest Imports', async () => {
    const asked = fakeAgenda([episode()], [recent({ is_upgrade: true }), recent({ title_id: 2, title: 'Bridge Show', kind: 'series', slot: '4k', files: 8, score: null })])
    renderApp()

    const coming = await screen.findByRole('region', { name: /coming this week/i })
    expect(await within(coming).findByText('S02E04')).toBeInTheDocument()
    expect(daysBetween(asked.at(-1)!)).toBe(6)
    const added = screen.getByRole('region', { name: /recently added/i })
    const rows = await within(added).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Paddington')
    expect(rows[0]).toHaveTextContent('Upgrade')
    expect(rows[0]).toHaveTextContent('120')
    expect(rows[1]).toHaveTextContent('8 files')
  })

  it('moves through both sections with j/k and opens a Title with Enter', async () => {
    fakeAgenda([episode()], [recent()])
    renderApp()
    const added = await screen.findByRole('region', { name: /recently added/i })
    await within(added).findByText('Paddington')

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toHaveTextContent('Bridge Show')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
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

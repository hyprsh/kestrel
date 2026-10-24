import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Upcoming = components['schemas']['UpcomingItem']

const upcoming = (n: number): Upcoming[] =>
  Array.from({ length: n }, (_, i) => ({
    date: dayString(1),
    kind: 'movie',
    title_id: 20 + i,
    title: `Movie ${i + 1}`,
    year: 2026,
    release_type: 'digital',
    season: null,
    episode: null,
    episode_name: null,
    searchable_from: null,
    released: true,
  }))

function fakeUpcoming(items: Upcoming[]) {
  server.use(http.get('/upcoming', ({ response }) => response(200).json({ from: dayString(), to: dayString(30), items })))
}

const downloads = (n: number) => Array.from({ length: n }, (_, i) => queueItem({ grab_id: i + 1, release_name: `Grab.${i + 1}-GRP` }))

describe('Overview sections', () => {
  it('shows the first five downloads, the count in the heading and a link to Activity', async () => {
    fakeQueue(downloads(7))
    renderApp()

    await screen.findByText('Grab.1-GRP')
    const section = screen.getByRole('region', { name: 'Downloading now · 7' })
    const rows = within(section).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Grab.${n}-GRP`)))

    await userEvent.click(within(section).getByRole('button', { name: 'View all 7 →' }))
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('')
  })
  it('shows the first five of the week, the count in the heading and a link to Upcoming', async () => {
    fakeUpcoming(upcoming(8))
    renderApp()

    await screen.findByText('Movie 1')
    const section = screen.getByRole('region', { name: 'Coming this week · 8' })
    const rows = within(section).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Movie ${n}`)))

    await userEvent.click(within(section).getByRole('button', { name: 'View all 8 →' }))
    expect(await screen.findByRole('list', { name: 'Agenda' })).toBeInTheDocument()
  })

  it("shows the five latest Imports, the week's count in the heading and a link to the Done stage of Activity", async () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({
      title_id: 40 + i,
      title: `Imported ${i + 1}`,
      year: 2026,
      kind: 'movie' as const,
      slot: 'standard' as const,
      release_name: `Imported.${i + 1}-GRP`,
      score: 100,
      score_delta: null,
      files: 1,
      is_upgrade: false,
      imported_at: '2026-10-17T12:00:00Z',
    }))
    server.use(http.get('/recent', ({ response }) => response(200).json({ items: recent, total: 12 })))
    renderApp()

    await screen.findByText('Imported.1-GRP')
    // GET /recent lists the latest few and counts the week's, which the Done stage lists.
    const section = screen.getByRole('region', { name: 'Recently added · 12' })
    const rows = within(section).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Imported.${n}-GRP`)))

    await userEvent.click(within(section).getByRole('button', { name: 'View all 12 →' }))
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:done')
  })

  it('moves j through the rows on show only, and through the rest once Needs attention is expanded', async () => {
    const warnings = Array.from({ length: 6 }, (_, i) => ({
      id: `w${i + 1}`,
      severity: 'warning' as const,
      kind: 'exdev',
      subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null },
      message: `Warning ${i + 1}`,
      since: '2026-10-18T09:30:00Z',
      count: 1,
      actions: [],
    }))
    server.use(
      http.get('/attention', ({ response }) => response(200).json({ count: 6, severity: 'warning', rows: warnings, long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } })),
    )
    fakeQueue(downloads(6))
    fakeUpcoming(upcoming(1))
    renderApp()
    await screen.findByText('Warning 1')
    await screen.findByText('Grab.1-GRP')
    await screen.findByText('Movie 1')

    const current = () => document.querySelector('[aria-current="true"]')
    const press = async (n: number) => {
      for (let i = 0; i < n; i++) await userEvent.keyboard('j')
    }
    expect(current()).toHaveTextContent('Warning 1')
    await press(5)
    expect(current()).toHaveTextContent('Grab.1-GRP')
    await press(5)
    expect(current()).toHaveTextContent('Movie 1')

    await userEvent.click(screen.getByRole('button', { name: 'View all 6' }))
    await press(1)
    expect(current()).toHaveTextContent('Movie 1')
    for (let i = 0; i < 6; i++) await userEvent.keyboard('k')
    expect(current()).toHaveTextContent('Warning 6')
  })
})

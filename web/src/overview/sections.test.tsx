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

    const section = await screen.findByRole('region', { name: 'Happening now · 7' })
    const rows = await within(section).findAllByRole('listitem')
    expect(rows).toHaveLength(5)

    await userEvent.click(within(section).getByRole('button', { name: 'All activity →' }))
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('')
  })

  it('moves j through the rows on show only, and through the rest once Happening now is expanded', async () => {
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
    fakeQueue(downloads(6).map((d, i) => ({ ...d, title: `Grab ${i + 1}` })))
    fakeUpcoming(upcoming(1))
    renderApp()
    await screen.findByText('Warning 1')
    await screen.findByText('Grab 1')
    await screen.findByText('Movie 1')

    const current = () => document.querySelector('[aria-current="true"]')
    const press = async (n: number) => {
      for (let i = 0; i < n; i++) await userEvent.keyboard('j')
    }
    expect(current()).toHaveTextContent('Warning 1')
    await press(5)
    expect(current()).toHaveTextContent('Grab 1')
    await press(5)
    expect(current()).toHaveTextContent('Movie 1')

    await userEvent.click(screen.getByRole('button', { name: 'View all 6' }))
    await press(1)
    expect(current()).toHaveTextContent('Movie 1')
    for (let i = 0; i < 6; i++) await userEvent.keyboard('k')
    expect(current()).toHaveTextContent('Warning 6')
  })
})

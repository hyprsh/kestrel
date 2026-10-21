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
})

import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { passOf } from '../test/search'
import { server } from '../test/server'

type ActivitySnapshot = components['schemas']['ActivitySnapshot']

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<App client={client} />)
  return client
}

/** Renders the app and puts an `activity` frame in its cache, as the stream does. */
async function withActivity(snapshot: Partial<ActivitySnapshot>) {
  const client = renderApp()
  await screen.findByRole('button', { name: 'Activity' })
  await frame(client, snapshot)
  return client
}

/** Another `activity` frame. The cache tells its readers on a zero timeout, so that runs too. */
async function frame(client: QueryClient, snapshot: Partial<ActivitySnapshot>) {
  await act(async () => {
    client.setQueryData(['activity'], { running: [], passes: [], adoption: null, ...snapshot })
    await vi.advanceTimersByTimeAsync(0)
  })
}

// What runs shows in the rail on a desktop.
// The Views of a side panel are a navigation too; the rail is the one without a name.
const topBar = () => within(screen.getByRole('navigation', { name: 'Screens' }))

describe('the rail', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('shows a loop once it has run for a second, and nothing before', async () => {
    await withActivity({ running: ['poll'] })

    expect(topBar().queryByRole('button', { name: /Polling/ })).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(topBar().getByRole('button', { name: 'Polling…' })).toBeInTheDocument()
  })

  it('counts the second from when the pass started, not from when the frame came', async () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    await withActivity({
      running: ['poll', 'rss'],
      passes: [
        { name: 'poll', started_at: ago(1500) },
        { name: 'rss', started_at: ago(600) },
      ],
    })

    expect(topBar().getByRole('button', { name: 'Polling…' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(400))
    expect(topBar().getByRole('button', { name: '2 running' })).toBeInTheDocument()
  })

  it('never shows a pass that ends within the second', async () => {
    const client = await withActivity({ running: ['poll'] })
    act(() => vi.advanceTimersByTime(500))
    await frame(client, { running: [] })
    act(() => vi.advanceTimersByTime(1000))

    expect(topBar().queryByRole('button', { name: /Polling/ })).not.toBeInTheDocument()
  })

  it('counts the work when several things run at once', async () => {
    await withActivity({ running: ['poll', 'refresh'] })
    act(() => vi.advanceTimersByTime(1000))

    expect(topBar().getByRole('button', { name: '2 running' })).toBeInTheDocument()
  })

  it("shows the search pass's progress", async () => {
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 40, episodes: 0, upgrades: 0 },
          pass: passOf({ done: 15, total: 40 }),
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    await withActivity({ running: ['search'] })
    act(() => vi.advanceTimersByTime(1000))

    expect(await topBar().findByRole('button', { name: 'Searching 15/40' })).toBeInTheDocument()
  })

  it('adds the Releases checked to the search pass, and what is searched now to the tooltip', async () => {
    const current = { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: 'Standard', season: 5, episodes: [], releases_seen: 12 }
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 4, episodes: 0, upgrades: 0 },
          pass: passOf({ done: 1, total: 4, releases_seen: 12, current }),
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    await withActivity({ running: ['search'] })
    act(() => vi.advanceTimersByTime(1000))

    const button = await topBar().findByRole('button', { name: 'Searching 1/4 · 12 releases' })
    expect(button).toHaveAttribute('title', expect.stringContaining('Now: Breaking Bad · S05 · Standard · 12 releases'))
  })

  it('shows an Adoption scan with its progress', async () => {
    await withActivity({ adoption: { state: 'scanning', done: 120, total: 450 } })
    act(() => vi.advanceTimersByTime(1000))

    expect(topBar().getByRole('button', { name: 'Scanning for files to adopt 120/450' })).toBeInTheDocument()
  })
})

describe('Running now', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const runningNow = () => within(screen.getByRole('region', { name: /^Running now/ }))

  it('opens from the rail and lists everything running by a readable name', async () => {
    await withActivity({ running: ['poll', 'trash'] })
    act(() => vi.advanceTimersByTime(1000))

    await user().click(topBar().getByRole('button', { name: '2 running' }))

    expect(await screen.findByRole('complementary', { name: 'Health' })).toBeInTheDocument()
    expect(location.pathname).toBe('/health/jobs')
    expect(
      runningNow()
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Polling the download client', 'Updating the TRaSH snapshot'])
  })

  it('shows the search pass as a compact row: what it is on, the releases checked, a Progress and "1 of 4"', async () => {
    const current = { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: '4K', season: 5, episodes: [], releases_seen: 37 }
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 4, episodes: 0, upgrades: 0 },
          pass: passOf({ done: 1, total: 4, releases_seen: 37, current }),
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    await withActivity({ running: ['search'] })
    act(() => vi.advanceTimersByTime(1000))

    await user().click(topBar().getByRole('button', { name: /^Searching/ }))

    const row = runningNow().getByRole('listitem')
    expect(row).toHaveTextContent('Searching for Wanted and Upgrades · now Breaking Bad · S05 · 4K · 37 releases · 37 releases checked')
    expect(within(row).getByRole('progressbar', { name: 'Searching for Wanted and Upgrades progress' })).toHaveAttribute('aria-valuenow', '1')
    expect(row).toHaveTextContent('1 of 4')
  })

  it('leads from an Adoption scan to the Adoption screen', async () => {
    server.use(
      http.get('/adoption', ({ response }) =>
        response(200).json({
          state: 'scanning',
          progress: { done: 120, total: 450 },
          summary: { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 },
          revision: 1,
          error: null,
          scanned_at: null,
          monitor: 'all',
          result: null,
        }),
      ),
      http.get('/adoption/rows', ({ response }) =>
        response(200).json({ items: [], next_cursor: null, total: 0, counts: { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 } }),
      ),
    )
    await withActivity({ adoption: { state: 'scanning', done: 120, total: 450 } })
    act(() => vi.advanceTimersByTime(1000))
    await user().click(topBar().getByRole('button', { name: /Scanning for files to adopt/ }))

    expect(runningNow().getByRole('listitem')).toHaveTextContent('Scanning for files to adopt120 of 450')
    expect(runningNow().getByRole('progressbar', { name: 'Scanning for files to adopt progress' })).toBeInTheDocument()
    await user().click(runningNow().getByRole('button', { name: 'Scanning for files to adopt' }))
    expect(await screen.findByRole('heading', { name: 'Adopt existing library' })).toBeInTheDocument()
  })

  it('leads from an Import to the Titles it is importing', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington')])
    fakeQueue([queueItem({ grab_id: 1, title_id: 5, phase: 'importing' }), queueItem({ grab_id: 2, title_id: 6, title: 'Heat', phase: 'downloading' })])
    await withActivity({ running: ['import'] })
    act(() => vi.advanceTimersByTime(1000))
    await user().click(topBar().getByRole('button', { name: 'Importing…' }))

    expect(runningNow().getByRole('listitem')).toHaveTextContent('Importing finished Grabs · Paddington')
    await user().click(runningNow().getByRole('button', { name: 'Paddington' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('says when nothing is running', async () => {
    await withActivity({})
    await user().click(await screen.findByRole('button', { name: /^Health/ }))

    expect(runningNow().getByText('Nothing is running right now.')).toBeInTheDocument()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
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

const topBar = () => within(screen.getByRole('banner'))

describe('the top bar', () => {
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
          pass: { started_at: new Date().toISOString(), done: 15, total: 40 },
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

  it('opens from the top bar and lists everything running by a readable name', async () => {
    await withActivity({ running: ['poll', 'trash'] })
    act(() => vi.advanceTimersByTime(1000))

    await user().click(topBar().getByRole('button', { name: '2 running' }))

    expect(topBar().getByText('Activity')).toBeInTheDocument()
    expect(
      runningNow()
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Polling the download client', 'Updating the TRaSH snapshot'])
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

    expect(runningNow().getByRole('listitem')).toHaveTextContent('Scanning for files to adopt 120/450')
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
    await user().click(screen.getByRole('button', { name: 'Activity' }))

    expect(runningNow().getByText('Nothing is running right now.')).toBeInTheDocument()
  })
})

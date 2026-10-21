import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
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
    client.setQueryData(['activity'], { running: [], adoption: null, ...snapshot })
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

    expect(await topBar().findByRole('button', { name: 'Searching… 15/40' })).toBeInTheDocument()
  })

  it('shows an Adoption scan with its progress', async () => {
    await withActivity({ adoption: { state: 'scanning', done: 120, total: 450 } })
    act(() => vi.advanceTimersByTime(1000))

    expect(topBar().getByRole('button', { name: 'Scanning for files to adopt… 120/450' })).toBeInTheDocument()
  })
})

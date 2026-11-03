import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { lastPassOf, passOf } from '../test/search'
import { server } from '../test/server'
import { findToast, toastRegion } from '../test/toasts'

type Job = components['schemas']['Job']

const searchJob: Job = {
  name: 'search',
  status: 'idle',
  disabled_by: null,
  runnable: true,
  last_run: null,
  recent_runs: [],
  next_at: null,
  schedule: { every_ms: 5 * 60_000, busy_every_ms: null, runs_every_ms: null },
  progress: null,
  outcome: null,
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** What the `search` frames of the stream would do to the cache. */
const frame = (over: Record<string, unknown>) =>
  act(async () => {
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({ due: { versions: 12, episodes: 0, upgrades: 0 }, pass: null, next_pass_at: null, last_pass: null, upgrades_per_pass: 5, indexers: [], ...over }),
      ),
    )
    await client.invalidateQueries({ queryKey: ['search'] })
  })

async function openHealth(jobs: Job[] = [searchJob]) {
  server.use(http.get('/jobs', ({ response }) => response(200).json({ items: jobs })))
  history.replaceState(null, '', '/health/jobs')
  render(<App client={client} />)
  const section = await screen.findByRole('region', { name: /^Background jobs/ })
  await within(section).findAllByRole('listitem')
  return section
}

const searchAll = () => screen.findByRole('button', { name: 'Search All Wanted' })
const toast = async () => within(await toastRegion())

beforeEach(() => {
  client.clear()
  history.replaceState(null, '', '/')
  server.use(http.post('/wanted/search', ({ response }) => response(202).json({ versions: 12 })))
})

describe('the search Toast', () => {
  it('shows one Toast for a search started here, follows the pass in place and ends with a summary', async () => {
    await frame({})
    await openHealth()
    await userEvent.click(await searchAll())
    expect(await findToast('12 Wanted Versions queued for a search')).toBeInTheDocument()

    await frame({ pass: passOf({ done: 3, total: 12, releases_seen: 418, grabbed: 1 }) })
    expect(await findToast('Searching 3 of 12 Wanted · 418 releases checked · 1 Grab')).toBeInTheDocument()
    expect((await toast()).getAllByRole('progressbar', { name: 'Search progress' }).length).toBeGreaterThan(0)
    expect((await toast()).getByRole('button', { name: 'Watch on Overview' })).toBeInTheDocument()

    await frame({ pass: passOf({ done: 6, total: 12, releases_seen: 500, grabbed: 2 }) })
    expect(await findToast('Searching 6 of 12 Wanted · 500 releases checked · 2 Grabs')).toBeInTheDocument()
    expect((await toast()).queryAllByText(/^Searching \d+ of/)).toHaveLength(1)

    await frame({ last_pass: lastPassOf({ searched: 12, grabbed: 2, releases_seen: 418 }) })
    expect(await findToast('Search done: 12 searched · 418 releases checked · 2 Grabs')).toBeInTheDocument()
    await waitFor(async () => expect((await toast()).queryByText(/^Searching \d+ of/)).not.toBeInTheDocument())
  })

  it('has an action that opens the Overview, where the search row is', async () => {
    await frame({})
    await openHealth()
    await userEvent.click(await searchAll())
    await frame({ pass: passOf({ done: 3, total: 12 }) })
    await userEvent.click((await toast()).getByRole('button', { name: 'Watch on Overview' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(location.pathname).toBe('/')
  })

  it('is the same Toast for Run now on the Search job', async () => {
    await frame({})
    server.use(http.post('/jobs/{name}/run', ({ response }) => response(202).empty()))
    await openHealth()
    await userEvent.click(screen.getByRole('button', { name: 'Run Search pass now' }))
    expect(await findToast('Search started')).toBeInTheDocument()

    await frame({ pass: passOf({ done: 1, total: 4 }) })
    expect(await findToast(/^Searching 1 of 4 Wanted/)).toBeInTheDocument()
  })

  it('shows an error Toast when the pass failed', async () => {
    await frame({})
    await openHealth([{ ...searchJob, last_run: { started_at: new Date().toISOString(), finished_at: new Date(Date.now() + 1000).toISOString(), duration_ms: 10, error: 'the indexer is down' } }])
    await userEvent.click(await searchAll())
    await frame({ pass: passOf() })
    await frame({ last_pass: lastPassOf() })

    expect(await findToast('Search failed: the indexer is down')).toBeInTheDocument()
  })

  it('shows no Toast for a pass the loop starts on its own', async () => {
    await frame({})
    await openHealth()
    await frame({ pass: passOf({ done: 3, total: 12 }) })
    await frame({ last_pass: lastPassOf() })

    await screen.findByText(/Last pass/)
    expect(screen.queryByText(/^Searching \d+ of/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Search done/)).not.toBeInTheDocument()
  })
})

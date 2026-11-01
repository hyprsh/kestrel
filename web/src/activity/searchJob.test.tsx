import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { lastPassOf, passOf } from '../test/search'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

type Job = components['schemas']['Job']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const search = (versions: number, pass: Partial<ReturnType<typeof passOf>> | null = null, over: Record<string, unknown> = {}) =>
  server.use(
    http.get('/search/status', ({ response }) =>
      response(200).json({
        due: { versions, episodes: 0, upgrades: 0 },
        pass: pass && passOf(pass),
        next_pass_at: null,
        last_pass: null,
        upgrades_per_pass: 5,
        indexers: [],
        ...over,
      }),
    ),
  )

/** The Search loop, as Background jobs lists it. */
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

/** The Search row of Background jobs on Health. */
async function row() {
  server.use(http.get('/jobs', ({ response }) => response(200).json({ items: [searchJob] })))
  history.replaceState(null, '', '/health/jobs')
  renderApp()
  const section = await screen.findByRole('region', { name: /^Background jobs/ })
  return (await within(section).findAllByRole('listitem')).find((li) => within(li).queryByText('Search', { selector: 'span' }))!
}

/** The Search row's "Search all Wanted" button. */
async function card() {
  return within(await row()).getByRole('button', { name: 'Search all Wanted' })
}

beforeEach(() => history.replaceState(null, '', '/'))

describe('the Search job row on Health', () => {
  it('queues every Wanted Version for a search and says how many in a Toast', async () => {
    search(12)
    let posted = 0
    server.use(
      http.post('/wanted/search', ({ response }) => {
        posted++
        return response(202).json({ versions: 12 })
      }),
    )
    const button = await card()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await findToast('12 Wanted Versions queued for a search')).toBeInTheDocument()
    expect(posted).toBe(1)
  })

  it('says in a Toast when the search could not be queued', async () => {
    search(3)
    server.use(http.post('/wanted/search', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'boom', detail: 'the indexer is down' }, { status: 500 })))
    await userEvent.click(await card())
    expect(await findToast(/search all wanted failed: the indexer is down/i)).toBeInTheDocument()
  })

  it('is disabled while the request runs', async () => {
    search(3)
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    server.use(
      http.post('/wanted/search', async ({ response }) => {
        await held
        return response(202).json({ versions: 3 })
      }),
    )
    const button = await card()
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    release()
    await findToast('3 Wanted Versions queued for a search')
  })

  it('is disabled while a pass is running, saying why', async () => {
    search(12, { done: 3, total: 12 })
    const button = await card()
    expect(button).toBeDisabled()
    expect(button.closest('span[title]')).toHaveAttribute('title', 'A search pass is running')
  })

  it('stays enabled when nothing is due now, so Wanted Versions waiting out their back-off can be searched', async () => {
    search(0)
    expect(await card()).toBeEnabled()
  })

  it('shows what waits and the last pass as lines of the row', async () => {
    search(0, null, {
      next_pass_at: new Date(Date.now() + 3 * 60_000).toISOString(),
      last_pass: lastPassOf({ finished_at: new Date(Date.now() - 2 * 60_000).toISOString(), searched: 40, grabbed: 3 }),
    })
    const r = await row()

    expect(r).toHaveTextContent('Nothing waiting · next pass in 3 min')
    expect(r).toHaveTextContent(/Last pass \d{1,2}:\d{2}.*: 40 searched · 418 releases checked · 3 Grabs · took 3 min/)
  })

  it('leaves a running pass to Running now and keeps its own lines to what waits and the last pass', async () => {
    search(12, {
      done: 4,
      total: 12,
      started_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      releases_seen: 418,
      current: { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: 'Standard', season: 5, episodes: [], releases_seen: 12 },
    })
    const r = await row()

    expect(r).toHaveTextContent('12 Wanted waiting')
    expect(r).not.toHaveTextContent('Searching Wanted')
    expect(within(r).queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

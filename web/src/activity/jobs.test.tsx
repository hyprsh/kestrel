import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast, toastRegion } from '../test/toasts'

type Job = components['schemas']['Job']

const min = 60_000
const at = (ms: number) => new Date(Date.now() + ms).toISOString()
const every = (ms: number, more: Partial<Job['schedule']> = {}): Job['schedule'] => ({ every_ms: ms, busy_every_ms: null, runs_every_ms: null, ...more })
const job = (over: Partial<Job>): Job => ({
  name: 'rss',
  status: 'idle',
  disabled_by: null,
  runnable: true,
  last_run: null,
  recent_runs: [],
  next_at: null,
  schedule: every(5 * min),
  progress: null,
  outcome: null,
  ...over,
})
const ran = (over: Partial<NonNullable<Job['last_run']>> = {}): NonNullable<Job['last_run']> => ({
  started_at: at(-5 * min - 2000),
  finished_at: at(-5 * min),
  duration_ms: 2000,
  error: null,
  ...over,
})

function fakeJobs(items: Job[]) {
  server.use(http.get('/jobs', ({ response }) => response(200).json({ items })))
}

async function openJobs(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole('button', { name: /^Health/ }))
  return screen.findByRole('region', { name: /^Background jobs/ })
}

const rowOf = async (section: HTMLElement, name: string) => (await within(section).findAllByRole('listitem')).find((li) => within(li).queryByText(name, { selector: 'span' }))!

const fine = (ms: number, ago: number) => ran({ started_at: at(-ago - ms), finished_at: at(-ago), duration_ms: ms })

describe('Background jobs', () => {
  it('lists each loop with what it does, how often it runs and how its last run went', async () => {
    fakeJobs([
      job({ name: 'rss', last_run: ran({ duration_ms: 200 }), next_at: at(10 * min), schedule: every(20 * min) }),
      job({ name: 'poll', runnable: false, last_run: ran({ duration_ms: 300 }), next_at: at(5 * min), schedule: every(5 * min, { busy_every_ms: 10_000 }) }),
      job({ name: 'refresh', schedule: every(60 * min, { runs_every_ms: 24 * 60 * min }) }),
      job({ name: 'import', schedule: every(min) }),
    ])
    const section = await openJobs()

    const rss = await rowOf(section, 'RSS')
    expect(rss).toHaveTextContent("Checks indexers' new Releases")
    expect(rss).toHaveTextContent('20 min')
    expect(rss).toHaveTextContent('ok · 0.2 s · 5 min ago')
    // The schedule is the server's: the cadences live with the loops.
    expect(await rowOf(section, 'Download check')).toHaveTextContent('10 s – 5 min')
    expect(await rowOf(section, 'Metadata refresh')).toHaveTextContent('1 d')
    expect(await rowOf(section, 'Import')).toHaveTextContent('1 min')
    expect(section).toHaveTextContent('Last 10: one bar per run, its height the duration; red runs failed.')
  })

  it('says when a loop has not run since start, failed, is running now or is turned off', async () => {
    fakeJobs([
      job({ name: 'search' }),
      job({ name: 'health', last_run: ran({ error: 'disk check: no such directory' }), next_at: at(3 * min) }),
      job({ name: 'refresh', status: 'running', last_run: ran() }),
    ])
    const section = await openJobs()

    expect(await rowOf(section, 'Search pass')).toHaveTextContent('not run since start')
    const health = await rowOf(section, 'Health')
    expect(health).toHaveTextContent('failed · 2.0 s · 5 min ago')
    expect(health).toHaveTextContent('disk check: no such directory')
    expect(await rowOf(section, 'Metadata refresh')).toHaveTextContent('running')
  })

  it('says since when a running loop runs, from the stream', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeJobs([job({ name: 'refresh', status: 'running' })])
    const section = await openJobs(client)
    act(() => client.setQueryData(['activity'], { running: ['refresh'], passes: [{ name: 'refresh', started_at: at(-2 * min) }], adoption: null }))

    await waitFor(async () => expect(await rowOf(section, 'Metadata refresh')).toHaveTextContent('running · started 2 min ago'))
  })

  it('says which setting turns a disabled loop off, and promises no run', async () => {
    const daily = every(60 * min, { runs_every_ms: 24 * 60 * min })
    fakeJobs([
      job({ name: 'updates', status: 'disabled', disabled_by: 'github_check', runnable: false, last_run: ran(), next_at: at(40 * min), schedule: daily }),
      job({ name: 'trash', status: 'disabled', disabled_by: 'trash_auto_update', runnable: false, last_run: ran(), next_at: at(40 * min), schedule: daily }),
    ])
    const section = await openJobs()

    const updates = await rowOf(section, 'Updates')
    expect(updates).toHaveTextContent('Off while “Check GitHub for updates” is off in Settings › Updates')
    const trash = await rowOf(section, 'TRaSH sync')
    expect(trash).toHaveTextContent('Off while “Check TRaSH daily and update automatically” is off in Settings › TRaSH')
    for (const row of [updates, trash]) {
      expect(row).not.toHaveTextContent(/ok ·|failed ·/)
    }
  })

  it('draws the last runs as bars with a text alternative, red only for a failed run', async () => {
    fakeJobs([
      job({
        name: 'poll',
        recent_runs: [fine(200, 9 * min), fine(300, 8 * min), ran({ duration_ms: 1400, error: 'boom' }), fine(200, 2 * min)],
      }),
      job({ name: 'prune' }),
    ])
    const section = await openJobs()

    const poll = await rowOf(section, 'Download check')
    const bars = within(poll).getByRole('img', { name: 'Download check: last 4 runs, oldest first. 3 ok, 1 failed. Took 0.2 s to 1.4 s.' })
    const colours = Array.from(bars.children).map((b) => (b.getAttribute('data-failed') === 'true' ? 'red' : 'gray'))
    expect(colours).toEqual(['gray', 'gray', 'red', 'gray'])
    // Heights follow the durations: the longest run is the tallest.
    const heights = Array.from(bars.children).map((b) => parseInt((b as HTMLElement).style.height))
    expect(heights[2]).toBe(Math.max(...heights))
    expect(within(await rowOf(section, 'Prune')).queryByRole('img', { name: /^Prune:/ })).not.toBeInTheDocument()
    expect(await rowOf(section, 'Prune')).toHaveTextContent('Prune: no runs yet')
  })

  it('runs the loops that are safe to run by hand', async () => {
    const posted: string[] = []
    server.use(http.post('/jobs/{name}/run', ({ params, response }) => (posted.push(params.name), response(202).empty())))
    fakeJobs([job({ name: 'search' }), job({ name: 'import', runnable: false }), job({ name: 'rss' })])
    const section = await openJobs()

    expect(within(await rowOf(section, 'Import')).queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
    await userEvent.click(within(await rowOf(section, 'Search pass')).getByRole('button', { name: 'Run Search pass now' }))
    await waitFor(() => expect(posted).toEqual(['search']))
    expect(await findToast('Search started')).toBeInTheDocument()
    expect(within(await toastRegion()).getByRole('button', { name: 'Watch on Overview' })).toBeInTheDocument()
    await userEvent.click(within(await rowOf(section, 'RSS')).getByRole('button', { name: 'Run RSS now' }))
    await waitFor(() => expect(posted).toEqual(['search', 'rss']))
    expect(await findToast('RSS started')).toBeInTheDocument()
  })

  it('says in a Toast when a loop could not be run', async () => {
    server.use(
      http.post('/jobs/{name}/run', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'already running' }, { status: 500 })),
    )
    fakeJobs([job({ name: 'search' })])
    const section = await openJobs()

    await userEvent.click(within(await rowOf(section, 'Search pass')).getByRole('button', { name: 'Run Search pass now' }))

    expect(await findToast('Could not run Search pass: already running')).toBeInTheDocument()
  })

  it('follows the stream', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeJobs([job({ name: 'rss' })])
    const section = await openJobs(client)
    expect(await rowOf(section, 'RSS')).toHaveTextContent('not run since start')

    act(() => client.setQueryData(['jobs'], { items: [job({ name: 'rss', status: 'running' })] }))

    await waitFor(async () => expect(await rowOf(section, 'RSS')).toHaveTextContent('running'))
  })
})

describe('Background jobs on a phone', () => {
  const phone = (matches: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: matches && q.includes('max-width: 639'), media: q, addEventListener() {}, removeEventListener() {} }))
  beforeEach(() => phone(true))
  afterEach(() => vi.unstubAllGlobals())

  it('says in one line that all ran fine in the last day, and opens onto the jobs', async () => {
    fakeJobs([job({ name: 'rss', recent_runs: [fine(200, 5 * min)] })])
    const section = await openJobs()

    expect(await within(section).findByText('All ran fine in the last day')).toBeInTheDocument()
    expect(within(section).queryByRole('list', { name: 'Background jobs' })).not.toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Show' }))
    expect(await rowOf(section, 'RSS')).toHaveTextContent('Every 5 min')
    expect(within(section).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('names the jobs that failed in the last day instead', async () => {
    fakeJobs([job({ name: 'rss', recent_runs: [ran({ error: 'boom' })] }), job({ name: 'poll', recent_runs: [fine(200, 5 * min)] })])
    const section = await openJobs()

    expect(await within(section).findByText('RSS failed in the last day')).toBeInTheDocument()
  })
})

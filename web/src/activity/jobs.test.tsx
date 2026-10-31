import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished } from 'vitest'
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
  next_at: null,
  schedule: every(5 * min),
  progress: null,
  outcome: null,
  ...over,
})
const ran = (over: Partial<NonNullable<Job['last_run']>> = {}): Job['last_run'] => ({
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
  await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
  return screen.findByRole('region', { name: /^Background jobs/ })
}

const rowOf = async (section: HTMLElement, name: string) => (await within(section).findAllByRole('listitem')).find((li) => within(li).queryByText(name, { selector: 'span' }))!

describe('Background jobs', () => {
  it('lists each loop with what it does, its schedule, its last run and when it runs next', async () => {
    fakeJobs([
      job({ name: 'rss', last_run: ran(), next_at: at(10 * min), schedule: every(20 * min) }),
      job({ name: 'poll', runnable: false, last_run: ran({ duration_ms: 300 }), next_at: at(5 * min), schedule: every(5 * min, { busy_every_ms: 10_000 }) }),
      job({ name: 'refresh', schedule: every(60 * min, { runs_every_ms: 24 * 60 * min }) }),
      job({ name: 'import', schedule: every(min) }),
    ])
    const section = await openJobs()

    const rss = await rowOf(section, 'RSS')
    expect(rss).toHaveTextContent("Checks indexers' new Releases")
    expect(rss).toHaveTextContent('Every 20 min')
    expect(rss).toHaveTextContent('Last run 5 min ago, took 2 s')
    expect(rss).toHaveTextContent('Next in 10 min')
    expect(rss).toHaveTextContent('Idle')
    // The schedule is the server's: the cadences live with the loops.
    expect(await rowOf(section, 'Poll')).toHaveTextContent('Every 10 s while downloading, else 5 min')
    expect(await rowOf(section, 'Refresh')).toHaveTextContent('Checked hourly, runs daily')
    expect(await rowOf(section, 'Import')).toHaveTextContent('Every minute')
  })

  it('says when a loop has not run since start, failed, is running now or is turned off', async () => {
    fakeJobs([
      job({ name: 'search' }),
      job({ name: 'health', last_run: ran({ error: 'disk check: no such directory' }), next_at: at(3 * min) }),
      job({ name: 'refresh', status: 'running', last_run: ran() }),
    ])
    const section = await openJobs()

    expect(await rowOf(section, 'Search')).toHaveTextContent('Not run since start')
    expect(await rowOf(section, 'Health')).toHaveTextContent('Last run failed 5 min ago: disk check: no such directory')
    expect(await rowOf(section, 'Refresh')).toHaveTextContent('Running now')
  })

  it('says which setting turns a disabled loop off, and promises no next run', async () => {
    const daily = every(60 * min, { runs_every_ms: 24 * 60 * min })
    fakeJobs([
      job({ name: 'updates', status: 'disabled', disabled_by: 'github_check', runnable: false, last_run: ran(), next_at: at(40 * min), schedule: daily }),
      job({ name: 'trash', status: 'disabled', disabled_by: 'trash_auto_update', runnable: false, last_run: ran(), next_at: at(40 * min), schedule: daily }),
    ])
    const section = await openJobs()

    const updates = await rowOf(section, 'Updates')
    expect(updates).toHaveTextContent('Disabled')
    expect(updates).toHaveTextContent('Off while “Check GitHub for updates” is off in Settings › Updates')
    const trash = await rowOf(section, 'TRaSH')
    expect(trash).toHaveTextContent('Off while “Check TRaSH daily and update automatically” is off in Settings › TRaSH')
    for (const row of [updates, trash]) {
      expect(row).not.toHaveTextContent(/Next in|Last run|runs daily/)
    }
  })

  it('runs the loops that are safe to run by hand', async () => {
    const posted: string[] = []
    server.use(http.post('/jobs/{name}/run', ({ params, response }) => (posted.push(params.name), response(202).empty())))
    fakeJobs([job({ name: 'search' }), job({ name: 'import', runnable: false })])
    const section = await openJobs()

    expect(within(await rowOf(section, 'Import')).queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
    await userEvent.click(within(await rowOf(section, 'Search')).getByRole('button', { name: 'Run Search now' }))
    await waitFor(() => expect(posted).toEqual(['search']))
    expect(await findToast('Search started')).toBeInTheDocument()
    expect(within(await toastRegion()).getByRole('button', { name: 'Watch in Activity' })).toBeInTheDocument()
  })

  it('says in a Toast when a loop could not be run', async () => {
    server.use(
      http.post('/jobs/{name}/run', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'already running' }, { status: 500 })),
    )
    fakeJobs([job({ name: 'search' })])
    const section = await openJobs()

    await userEvent.click(within(await rowOf(section, 'Search')).getByRole('button', { name: 'Run Search now' }))

    expect(await findToast('Could not run Search: already running')).toBeInTheDocument()
  })

  it('follows the stream', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeJobs([job({ name: 'rss' })])
    const section = await openJobs(client)
    expect(await rowOf(section, 'RSS')).toHaveTextContent('Not run since start')

    act(() => client.setQueryData(['jobs'], { items: [job({ name: 'rss', status: 'running' })] }))

    await waitFor(async () => expect(await rowOf(section, 'RSS')).toHaveTextContent('Running now'))
  })

  it('is where the Overview’s Searching card points', async () => {
    const scrolled: Element[] = []
    // jsdom does not scroll: record what is scrolled to instead.
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    onTestFinished(() => {
      Element.prototype.scrollIntoView = before
    })
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

    const card = await screen.findByRole('region', { name: 'Searching' })
    await userEvent.click(within(card).getByRole('button', { name: 'Background jobs' }))

    const section = await screen.findByRole('region', { name: /^Background jobs/ })
    await waitFor(() => expect(scrolled.some((el) => el.contains(section))).toBe(true))
  })
})

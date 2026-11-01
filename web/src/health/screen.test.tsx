// The Health screen as a whole: its address, the old Activity address, the verdict, the checks in groups and the panel.
// tiles.test.ts covers what each tile shows, problems.test.ts the verdict's sentences.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { clockTime } from '../time'

type Status = components['schemas']['SystemStatus']
type Attention = components['schemas']['Attention']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search

const since = new Date(Date.now() - 60_000).toISOString()
const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null, since: null }
const alpha = { instance_id: 11, name: 'Alpha', state: 'ok' as const, message: null, ...idle, search_used: 42, search_max: 100 }
const beta = { instance_id: 12, name: 'Beta', state: 'failing' as const, message: 'API key rejected', ...idle, since }
const status = (over: Partial<Status> = {}): Status => ({
  version: '1.8.2',
  started_at: new Date(Date.now() - (6 * 24 + 4) * 3_600_000).toISOString(),
  services: [],
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [alpha, beta],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }],
  trash: { commit: 'abc1234def', committed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})
const fakeStatus = (s: Status) => server.use(http.get('/system/status', ({ response }) => response(200).json(s)))

const betaRow: Attention['rows'][number] = {
  id: 'health-9',
  severity: 'blocking',
  kind: 'indexer_failing',
  subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: 12 },
  message: "Beta rejected Kestrel's API key",
  since,
  count: 1,
  actions: [
    { key: 'test', label: 'Test', method: 'POST', path: '/plugin-instances/12/test', body: null, confirm: null },
    { key: 'open', label: 'Open in Settings', method: 'GET', path: '/settings/indexers', body: null, confirm: null },
  ],
}
const fakeRows = (rows: Attention['rows']) =>
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({ count: rows.length, severity: rows.length > 0 ? rows[0].severity : null, rows, long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } }),
    ),
  )

beforeEach(() => history.replaceState(null, '', '/'))

describe('Health screen', () => {
  const openHealth = async () => {
    history.replaceState(null, '', '/health')
    renderApp()
    return screen.findByRole('region', { name: 'Health' })
  }

  it('lists every check in Connections, Storage and System, a failing one first and tinted, each with a status dot and one detail line', async () => {
    fakeStatus(status())
    const panel = await openHealth()

    const connections = (await within(panel).findByRole('heading', { name: 'Connections' })).parentElement!
    expect(within(panel).getByRole('heading', { name: 'Storage' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'System' })).toBeInTheDocument()
    const tiles = within(connections).getAllByRole('listitem')
    expect(tiles[0]).toHaveTextContent(`Beta`)
    expect(tiles[0]).toHaveTextContent(`API key rejected, since ${clockTime(since)}`)
    expect(tiles[0]).toHaveAttribute('data-tone', 'failing')
    expect(within(tiles[0]).getByRole('img', { name: 'Beta: failing' })).toBeInTheDocument()
    expect(tiles[1]).toHaveTextContent('SABnzbd')
    expect(tiles[1]).toHaveTextContent('Connected')
    expect(tiles[1]).toHaveAttribute('data-tone', 'ok')
    expect(panel).toHaveTextContent('Alpha')
    expect(panel).toHaveTextContent('Answering · 42 of 100 searches today')
    expect(panel).toHaveTextContent('800 GB free · 22% used')
    expect(panel).toHaveTextContent('1.8.2 · up to date')
  })

  it('says how many checks are ok and how many fail, over Run Checks Again', async () => {
    fakeStatus(status())
    const panel = await openHealth()

    const checks = await within(panel).findByRole('region', { name: 'Checks' })
    expect(within(checks).getByText('5 ok · 1 failing')).toBeInTheDocument()
    expect(within(checks).getByRole('button', { name: 'Run Checks Again' })).toBeInTheDocument()
  })

  it('counts warnings too', async () => {
    const lowDisk = { path: '/data', free_bytes: 10 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }
    fakeStatus(status({ indexers: [alpha], disks: [lowDisk], grabs_paused: true }))
    const panel = await openHealth()

    expect(await within(panel).findByText('4 ok · 0 failing · 2 warnings')).toBeInTheDocument()
  })

  it('runs the Health loop when asked to run the checks again', async () => {
    const posted: string[] = []
    server.use(http.post('/jobs/{name}/run', ({ params, response }) => (posted.push(params.name), response(202).empty())))
    fakeStatus(status())
    const panel = await openHealth()

    await userEvent.click(await within(panel).findByRole('button', { name: 'Run Checks Again' }))

    await waitFor(() => expect(posted).toEqual(['health']))
  })

  it('reads the checks again when the Health loop ends a pass', async () => {
    let reads = 0
    server.use(http.get('/system/status', ({ response }) => (reads++, response(200).json(status()))))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    history.replaceState(null, '', '/health')
    render(<App client={client} />)
    await screen.findByRole('heading', { name: 'Connections' })
    const before = reads
    const job = {
      name: 'health',
      status: 'idle',
      disabled_by: null,
      runnable: true,
      last_run: { started_at: since, finished_at: since, duration_ms: 20, error: null },
      recent_runs: [],
      next_at: null,
      schedule: { every_ms: 300_000, busy_every_ms: null, runs_every_ms: null },
      progress: null,
      outcome: null,
    }
    client.setQueryData(['jobs'], { items: [job] })
    client.setQueryData(['jobs'], { items: [{ ...job, last_run: { ...job.last_run, finished_at: new Date().toISOString() } }] })

    await waitFor(() => expect(reads).toBeGreaterThan(before))
  })

  describe('the verdict', () => {
    it('says it is all good, with no tint, when nothing fails', async () => {
      fakeStatus(status({ indexers: [alpha] }))
      fakeRows([])
      const panel = await openHealth()

      const verdict = await within(panel).findByRole('region', { name: 'Verdict' })
      expect(verdict).toHaveTextContent('All good')
      expect(verdict).toHaveAttribute('data-tone', 'ok')
      expect(within(verdict).queryByRole('button')).not.toBeInTheDocument()
    })

    it('says how many problems need you, in a sentence each, tinted red, and goes where it gets fixed', async () => {
      fakeStatus(status())
      fakeRows([betaRow])
      const panel = await openHealth()

      const verdict = await within(panel).findByRole('region', { name: 'Verdict' })
      expect(within(verdict).getByRole('heading', { name: '1 problem needs you' })).toBeInTheDocument()
      expect(verdict).toHaveTextContent(`Beta rejected Kestrel's API key, since ${clockTime(since)}. Searches skip it until it is fixed. Everything else is fine.`)
      expect(verdict).toHaveAttribute('data-tone', 'blocking')
      await userEvent.click(within(verdict).getByRole('button', { name: 'Fix in Settings' }))
      expect(location.pathname).toMatch(/^\/settings/)
    })

    it('is amber and says warnings when only warnings show', async () => {
      fakeStatus(status({ indexers: [alpha] }))
      fakeRows([{ ...betaRow, severity: 'warning', kind: 'low_disk_space', message: 'Low disk space on /data', actions: [] }])
      const panel = await openHealth()

      const verdict = await within(panel).findByRole('region', { name: 'Verdict' })
      expect(within(verdict).getByRole('heading', { name: '1 warning to look at' })).toBeInTheDocument()
      expect(verdict).toHaveAttribute('data-tone', 'warning')
    })

    it('keeps the rail button in step: a problem makes its name say so, and all good says all OK', async () => {
      fakeStatus(status())
      fakeRows([betaRow])
      renderApp()
      expect(await screen.findByRole('button', { name: 'Health · 1 Blocking' })).toBeInTheDocument()
    })
  })

  it('counts the failing checks in red on Checks in the panel and hides the count when all is well', async () => {
    fakeStatus(status())
    await openHealth()

    const checks = within(screen.getByRole('navigation', { name: 'Views' })).getByRole('button', { name: /^Checks/ })
    await waitFor(() => expect(checks).toHaveTextContent('1'))
    expect(within(checks).getByText('1')).toHaveAttribute('data-tone', 'failing')
  })

  it('hides the Checks count while all is well', async () => {
    fakeStatus(status({ indexers: [alpha] }))
    await openHealth()

    const checks = within(screen.getByRole('navigation', { name: 'Views' })).getByRole('button', { name: /^Checks/ })
    await within(await screen.findByRole('region', { name: 'Health' })).findByRole('heading', { name: 'Connections' })
    expect(checks).toHaveAccessibleName('Checks')
  })

  it("says the version, the uptime and how fresh the checks are in the panel's footer", async () => {
    fakeStatus(status())
    await openHealth()

    expect(await within(screen.getByRole('complementary', { name: 'Health' })).findByText('Kestrel 1.8.2 · up 6 d 4 h · checked just now')).toBeInTheDocument()
  })

  it('opens at /health with its side panel, no screen bar and no view switcher', async () => {
    fakeStatus(status())
    await openHealth()

    expect(screen.getByRole('complementary', { name: 'Health' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Activity:/ })).not.toBeInTheDocument()
  })

  it('puts Running now first, then Checks, then Background jobs, in the sections and in the Views', async () => {
    fakeStatus(status())
    const panel = await openHealth()
    await within(panel).findByRole('heading', { name: 'Storage' })

    const order = ['Running now', 'Checks', 'Background jobs']
    const headings = within(panel)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent ?? '')
      .filter((t) => order.some((o) => t.startsWith(o)))
    expect(headings.map((t) => order.find((o) => t.startsWith(o)))).toEqual(order)
    const views = within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('button')
    order.forEach((name, i) => expect(views[i]).toHaveAccessibleName(new RegExp(`^${name}`)))
    expect(views[0]).toHaveAttribute('aria-current', 'true')
  })

  // The rail is the navigation without a name; a side panel's Views are named.
  const rail = async () => (await screen.findAllByRole('navigation')).find((n) => !n.hasAttribute('aria-label'))!

  it('opens from the rail button, which is the current page while Health is shown', async () => {
    fakeStatus(status())
    renderApp()

    const button = await within(await rail()).findByRole('button', { name: /^Health/ })
    expect(button).not.toHaveAttribute('aria-current')
    await userEvent.click(button)
    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
    expect(url()).toBe('/health')
    expect(button).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(await rail()).getByRole('button', { name: 'Overview' }))
    expect(button).not.toHaveAttribute('aria-current')
  })

  it('is a place in the command menu', async () => {
    fakeStatus(status())
    renderApp()

    await screen.findByRole('navigation')
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog')
    await userEvent.keyboard('health')
    // Enter picks the first row, so wait for the list to have settled on Health before pressing it.
    await within(menu).findByRole('option', { name: /^Health/ })
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
    expect(url()).toBe('/health')
  })

  it('has a Checks section and a Background jobs section, with their own addresses', async () => {
    fakeStatus(status())
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    try {
      history.replaceState(null, '', '/health/jobs')
      renderApp()
      const region = await screen.findByRole('region', { name: 'Health' })
      expect(await within(region).findByRole('region', { name: /^Checks/ })).toBeInTheDocument()
      expect(within(region).getByRole('region', { name: /^Running now/ })).toBeInTheDocument()
      expect(await within(region).findByRole('region', { name: /^Background jobs/ })).toBeInTheDocument()
      expect(scrolled).toContain('health-jobs')
      expect(url()).toBe('/health/jobs')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('takes the old /activity/jobs and /activity/running addresses to the Background jobs section', async () => {
    fakeStatus(status())
    for (const old of ['/activity/jobs', '/activity/running']) {
      history.replaceState(null, '', old)
      const { unmount } = renderApp()
      expect(await screen.findByRole('region', { name: /^Background jobs/ })).toBeInTheDocument()
      expect(url()).toBe('/health/jobs')
      unmount()
    }
  })

  it('takes the old /activity/health address to /health', async () => {
    fakeStatus(status())
    history.replaceState(null, '', '/activity/health')
    renderApp()

    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
    expect(url()).toBe('/health')
  })

  it('takes a Back to /activity/health in the history to the Health screen too', async () => {
    fakeStatus(status())
    history.replaceState(null, '', '/activity')
    renderApp()
    await screen.findByRole('combobox', { name: 'Filter Activity' })
    history.pushState(null, '', '/activity/health')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
  })
})

describe('Health on a phone', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 639'), media: q, addEventListener() {}, removeEventListener() {} })))
  afterEach(() => vi.unstubAllGlobals())

  it('puts the verdict first with a full-width Fix button, then the checks as a list with the failing one tinted', async () => {
    fakeStatus(status())
    fakeRows([betaRow])
    history.replaceState(null, '', '/health')
    renderApp()

    const verdict = await screen.findByRole('region', { name: 'Verdict' })
    expect(within(verdict).getByRole('button', { name: 'Fix in Settings' })).toBeInTheDocument()
    const connections = (await screen.findByRole('heading', { name: 'Connections' })).parentElement!
    const rows = within(connections).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Beta')
    expect(rows[0]).toHaveAttribute('data-tone', 'failing')
    expect(rows[1]).toHaveAttribute('data-tone', 'ok')
    expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
  })
})

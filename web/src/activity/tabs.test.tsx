import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { fakeGrabs, grabEntry } from '../test/grabs'
import { http } from '../test/handlers'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'

type Status = components['schemas']['SystemStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search
const tab = (name: RegExp | string) => screen.findByRole('tab', { name })

const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null }
const alpha = { instance_id: 11, name: 'Alpha', state: 'ok' as const, message: null, ...idle, search_used: 42, search_max: 100 }
const beta = { instance_id: 12, name: 'Beta', state: 'failing' as const, message: 'API key rejected', ...idle }
const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [alpha, beta],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }],
  trash: { commit: 'abc1234def', committed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})
const fakeStatus = (s: Status) => server.use(http.get('/system/status', ({ response }) => response(200).json(s)))

beforeEach(() => history.replaceState(null, '', '/'))

describe('Activity tabs', () => {
  it('shows Grabs, Health and Background Jobs, Grabs selected at /activity with the number of active Grabs', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' }), queueItem({ grab_id: 2, phase: 'queued' })])
    history.replaceState(null, '', '/activity')
    renderApp()

    expect(await tab(/^Grabs/)).toHaveAttribute('aria-selected', 'true')
    expect(await tab(/^Grabs 2/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /^Background Jobs/ })).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toBeInTheDocument()
  })

  it('gives each tab its own address and keeps the Grabs ?q=', async () => {
    history.replaceState(null, '', '/activity?q=stage:done')
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' })])
    renderApp()
    expect(await screen.findByRole('region', { name: 'Done · 1' })).toBeInTheDocument()

    await userEvent.click(await tab(/^Health/))
    expect(url()).toBe('/activity/health')
    await userEvent.click(await tab(/^Background Jobs/))
    expect(url()).toBe('/activity/jobs')
    await userEvent.click(await tab(/^Grabs/))
    expect(url()).toBe('/activity?q=stage%3Adone')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:done')
  })

  it('opens at /activity/health, /activity/jobs and the old /activity/running (Background Jobs)', async () => {
    for (const [path, name] of [
      ['/activity/health', /^Health/],
      ['/activity/jobs', /^Background Jobs/],
      ['/activity/running', /^Background Jobs/],
    ] as const) {
      history.replaceState(null, '', path)
      const { unmount } = renderApp()
      expect(await tab(name)).toHaveAttribute('aria-selected', 'true')
      unmount()
    }
    history.replaceState(null, '', '/activity/running')
    renderApp()
    expect(await screen.findByRole('region', { name: /^Running now/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^Background jobs/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter Activity' })).not.toBeInTheDocument()
  })

  it('moves between tabs with Back and Forward', async () => {
    history.replaceState(null, '', '/activity')
    renderApp()
    await userEvent.click(await tab(/^Health/))
    await userEvent.click(await tab(/^Background Jobs/))

    history.back()
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute('aria-selected', 'true'))
    expect(url()).toBe('/activity/health')
    history.back()
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Grabs/ })).toHaveAttribute('aria-selected', 'true'))
    history.forward()
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('opens a tab in a new window on Ctrl-click, like a link, and stays on the tab it was on', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    history.replaceState(null, '', '/activity')
    renderApp()

    const user = userEvent.setup()
    await user.keyboard('{Control>}')
    await user.click(await tab(/^Health/))
    await user.keyboard('{/Control}')

    expect(String(open.mock.calls[0][0])).toBe('http://localhost:3000/activity/health')
    expect(url()).toBe('/activity')
    expect(screen.getByRole('tab', { name: /^Grabs/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('follows the WAI-ARIA tabs keys', async () => {
    history.replaceState(null, '', '/activity')
    renderApp()
    const grabs = await tab(/^Grabs/)
    grabs.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveFocus()
    expect(url()).toBe('/activity/health')
  })
})

describe('Activity Health tab', () => {
  const openHealth = async () => {
    history.replaceState(null, '', '/activity/health')
    renderApp()
    return screen.findByRole('tabpanel')
  }

  it('lists every check, grouped, failing first, each with its state as a word', async () => {
    fakeStatus(status({ indexers: [alpha, beta] }))
    const panel = await openHealth()

    const group = await within(panel).findByRole('heading', { name: 'Indexers' })
    expect(within(panel).getByRole('heading', { name: 'Download client' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Disks' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    const indexers = within(group.parentElement!).getAllByRole('listitem')
    expect(indexers[0]).toHaveTextContent(/Beta.*failing.*API key rejected/)
    expect(indexers[1]).toHaveTextContent(/Alpha.*ok.*42 of 100 searches today/)
    expect(within(indexers[1]).getByRole('progressbar', { name: 'Alpha searches used today' })).toBeInTheDocument()
    expect(panel).toHaveTextContent(/SABnzbd.*ok/)
    expect(panel).toHaveTextContent('800 GB free of 1 TB')
    expect(panel).toHaveTextContent(/TRaSH.*3 days old/)
  })

  it('says how many checks fail, how many are ok and when they were checked, and the tab shows a dot', async () => {
    fakeStatus(status())
    const panel = await openHealth()

    expect(await within(panel).findByText(/1 problem/)).toHaveTextContent(/1 problem · 4 OK · checked \d/)
    expect(await tab(/^Health failing/)).toBeInTheDocument()
  })

  it('has no dot and says all checks are OK when every check passes', async () => {
    fakeStatus(status({ indexers: [{ ...alpha, search_max: null }] }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/All checks OK/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAccessibleName('Health')
  })

  it('shows the dot from the other tabs too', async () => {
    fakeStatus(status())
    history.replaceState(null, '', '/activity')
    renderApp()

    expect(await tab(/^Health failing/)).toBeInTheDocument()
  })

  it("offers the failing check's action from the matching Needs attention row", async () => {
    fakeStatus(status())
    server.use(
      http.get('/attention', ({ response }) =>
        response(200).json({
          count: 1,
          severity: 'warning',
          rows: [
            {
              id: 'health-9',
              severity: 'warning',
              kind: 'indexer_failing',
              subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: 12 },
              message: 'Beta is failing',
              since: new Date().toISOString(),
              count: 1,
              actions: [{ key: 'open', label: 'Open Indexers', method: 'GET', path: '/settings/indexers', body: null, confirm: null }],
            },
          ],
          long_missing: { count: 0, items: [] },
          originals: { count: 0, items: [] },
        }),
      ),
    )
    const panel = await openHealth()

    await userEvent.click(await within(panel).findByRole('button', { name: 'Open Indexers' }))
    expect(url()).toBe('/settings')
  })
})

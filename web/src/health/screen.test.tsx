// The Health screen as a whole: its address, the old Activity address, the summary and the actions of a failing check.
// health.test.tsx covers what each tile shows.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Status = components['schemas']['SystemStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search

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

describe('Health screen', () => {
  const openHealth = async () => {
    history.replaceState(null, '', '/health')
    renderApp()
    return screen.findByRole('region', { name: 'Health' })
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

  it('says how many checks fail, how many are ok and when they were checked', async () => {
    fakeStatus(status())
    const panel = await openHealth()

    expect(await within(panel).findByText(/1 problem/)).toHaveTextContent(/1 problem · 4 OK · checked \d/)
  })

  it('counts warnings too', async () => {
    const lowDisk = { path: '/data', free_bytes: 10 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }
    fakeStatus(status({ indexers: [alpha], disks: [lowDisk], grabs_paused: true }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/2 warnings/)).toHaveTextContent(/^2 warnings · 3 OK · checked \d/)
    expect(panel).not.toHaveTextContent(/All checks OK/)
  })

  it('counts problems and warnings together', async () => {
    const lowDisk = { path: '/data', free_bytes: 10 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }
    fakeStatus(status({ disks: [lowDisk] }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/1 problem/)).toHaveTextContent(/^1 problem · 1 warning · 3 OK · checked \d/)
  })

  it('says all checks are OK when every check passes', async () => {
    fakeStatus(status({ indexers: [{ ...alpha, search_max: null }] }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/All checks OK/)).toBeInTheDocument()
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

  it('opens at /health with the shared top bar, no screen bar and no view switcher', async () => {
    fakeStatus(status())
    await openHealth()

    expect(screen.getByRole('banner')).toHaveTextContent('Health')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Activity:/ })).not.toBeInTheDocument()
  })

  it('opens from the rail button, which is the current page while Health is shown', async () => {
    fakeStatus(status())
    renderApp()

    const button = await within(await screen.findByRole('navigation')).findByRole('button', { name: /^Health/ })
    expect(button).not.toHaveAttribute('aria-current')
    await userEvent.click(button)
    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
    expect(url()).toBe('/health')
    expect(button).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Overview' }))
    expect(button).not.toHaveAttribute('aria-current')
  })

  it('is a place in the command menu', async () => {
    fakeStatus(status())
    renderApp()

    await screen.findByRole('navigation')
    await userEvent.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog')
    await userEvent.keyboard('health{Enter}')
    expect(await screen.findByRole('region', { name: 'Health' })).toBeInTheDocument()
    expect(url()).toBe('/health')
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

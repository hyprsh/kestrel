import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { fakeGrabs, grabEntry } from '../test/grabs'
import { http } from '../test/handlers'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'

type Status = components['schemas']['SystemStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search
/** The view switcher, naming the page the screen is on. */
const onView = (name: string) => screen.findByRole('button', { name: `Activity: ${name}` })
/** Opens the switcher and picks a page. */
async function goTo(name: RegExp | string, user = userEvent) {
  await user.click(await screen.findByRole('button', { name: /^Activity:/ }))
  await user.click(await screen.findByRole('menuitemradio', { name }))
}
/** The switcher's open menu, to read what each page shows beside its name. */
async function openSwitcher() {
  await userEvent.click(await screen.findByRole('button', { name: /^Activity:/ }))
  return screen.findByRole('menu')
}

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

describe('Activity views', () => {
  it('lists Grabs, Health and Background Jobs in the switcher, Grabs selected at /activity with the number of active Grabs', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' }), queueItem({ grab_id: 2, phase: 'queued' })])
    history.replaceState(null, '', '/activity')
    renderApp()

    expect(await onView('Grabs')).toBeInTheDocument()
    const menu = await openSwitcher()
    expect(within(menu).getByRole('menuitemradio', { name: 'Grabs' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Grabs' })).toHaveTextContent('2'))
    expect(within(menu).getByRole('menuitemradio', { name: 'Health' })).toHaveAttribute('aria-checked', 'false')
    expect(within(menu).getByRole('menuitemradio', { name: 'Background Jobs' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toBeInTheDocument()
  })

  it('gives each tab its own address and keeps the Grabs ?q=', async () => {
    history.replaceState(null, '', '/activity?q=stage:done')
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' })])
    renderApp()
    expect(await screen.findByRole('region', { name: 'Done · 1' })).toBeInTheDocument()

    await goTo('Health')
    expect(url()).toBe('/activity/health')
    await goTo('Background Jobs')
    expect(url()).toBe('/activity/jobs')
    await goTo('Grabs')
    expect(url()).toBe('/activity?q=stage%3Adone')
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:done')
  })

  it('opens at /activity/health, /activity/jobs and the old /activity/running (Background Jobs)', async () => {
    for (const [path, name] of [
      ['/activity/health', 'Health'],
      ['/activity/jobs', 'Background Jobs'],
      ['/activity/running', 'Background Jobs'],
    ] as const) {
      history.replaceState(null, '', path)
      const { unmount } = renderApp()
      expect(await onView(name)).toBeInTheDocument()
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
    await goTo('Health')
    await goTo('Background Jobs')

    history.back()
    expect(await onView('Health')).toBeInTheDocument()
    expect(url()).toBe('/activity/health')
    history.back()
    expect(await onView('Grabs')).toBeInTheDocument()
    history.forward()
    expect(await onView('Health')).toBeInTheDocument()
  })
})

/** The state word of the dot beside Health in the open switcher. */
async function expectDot(word: 'failing' | 'warning') {
  const menu = await openSwitcher()
  await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Health' })).toHaveTextContent(word))
  await userEvent.keyboard('{Escape}')
}

describe('Activity Health view', () => {
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

  it('says how many checks fail, how many are ok and when they were checked, and the switcher shows a dot beside Health', async () => {
    fakeStatus(status())
    const panel = await openHealth()

    expect(await within(panel).findByText(/1 problem/)).toHaveTextContent(/1 problem · 4 OK · checked \d/)
    await expectDot('failing')
  })

  it('counts warnings too, and shows a warning dot when nothing fails', async () => {
    const lowDisk = { path: '/data', free_bytes: 10 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }
    fakeStatus(status({ indexers: [alpha], disks: [lowDisk], grabs_paused: true }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/2 warnings/)).toHaveTextContent(/^2 warnings · 3 OK · checked \d/)
    expect(panel).not.toHaveTextContent(/All checks OK/)
    await expectDot('warning')
  })

  it('counts problems and warnings together, and the dot is for the failures', async () => {
    const lowDisk = { path: '/data', free_bytes: 10 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }
    fakeStatus(status({ disks: [lowDisk] }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/1 problem/)).toHaveTextContent(/^1 problem · 1 warning · 3 OK · checked \d/)
    await expectDot('failing')
  })

  it('has no dot and says all checks are OK when every check passes', async () => {
    fakeStatus(status({ indexers: [{ ...alpha, search_max: null }] }))
    const panel = await openHealth()

    expect(await within(panel).findByText(/All checks OK/)).toBeInTheDocument()
    expect(within(await openSwitcher()).getByRole('menuitemradio', { name: 'Health' })).not.toHaveTextContent(/failing|warning/)
  })

  it('shows the dot from the other tabs too', async () => {
    fakeStatus(status())
    history.replaceState(null, '', '/activity')
    renderApp()

    await expectDot('failing')
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

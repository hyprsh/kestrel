import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Status = components['schemas']['SystemStatus']
type SearchStatus = components['schemas']['SearchStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const url = () => location.pathname + location.search

const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null }
const GB = 2 ** 30
const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [
    { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle, search_used: 30, search_max: 100 },
    { instance_id: 12, name: 'Beta', state: 'ok', message: null, ...idle, search_used: 10, search_max: 50 },
    { instance_id: 13, name: 'Gamma', state: 'disabled', message: null, ...idle },
  ],
  disks: [{ path: '/media', free_bytes: 800 * GB, total_bytes: 1024 * GB, low_free_bytes: 50 * GB }],
  trash: { commit: 'abc1234def', committed_at: new Date().toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})
const fakeStatus = (s: Status) => server.use(http.get('/system/status', ({ response }) => response(200).json(s)))

const searchStatus = (over: Partial<SearchStatus> = {}): SearchStatus => ({
  due: { versions: 0, episodes: 0, upgrades: 0 },
  pass: null,
  next_pass_at: null,
  last_pass: null,
  upgrades_per_pass: 5,
  indexers: [],
  ...over,
})
const fakeSearch = (s: SearchStatus) => server.use(http.get('/search/status', ({ response }) => response(200).json(s)))

const row = (id: string, severity: 'blocking' | 'warning') => ({
  id,
  severity,
  kind: 'exdev',
  subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null },
  message: `Row ${id}`,
  since: '2026-10-18T09:30:00Z',
  count: 1,
  actions: [],
})
const fakeAttention = (rows: ReturnType<typeof row>[]) =>
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({ count: rows.length, severity: rows[0]?.severity ?? 'warning', rows, long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } }),
    ),
  )

// A low disk and a busy search, which the status pills used to show: neither shows on the Overview now.
const lowDiskAndBusySearch = () => {
  fakeStatus(status({ disks: [{ path: '/media', free_bytes: 6 * GB, total_bytes: 100 * GB, low_free_bytes: 50 * GB }] }))
  fakeSearch(
    searchStatus({
      due: { versions: 12, episodes: 0, upgrades: 0 },
      pass: { started_at: new Date().toISOString(), done: 3, total: 12 },
      next_pass_at: new Date(Date.now() + 14 * 60_000 + 5000).toISOString(),
    }),
  )
}

const topBar = () => screen.findByRole('banner')

beforeEach(() => history.replaceState(null, '', '/'))

/** The desktop's rail, where Health is. */
const rail = () => screen.findByRole('navigation')

describe('the Overview on a desktop', () => {
  it('has no status pills: Health is a rail button, and the search, indexers and low disk are not repeated', async () => {
    lowDiskAndBusySearch()
    fakeAttention([])
    renderApp()

    await within(await rail()).findByRole('button', { name: /All checks OK/ })
    expect(within(await topBar()).queryByRole('button', { name: /^Health/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Searching|Wanted waiting|Nothing waiting/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /indexers?\b/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /full$/ })).not.toBeInTheDocument()
  })

  it('counts Needs attention rows by severity on the Health button, and links to Health', async () => {
    fakeStatus(status())
    fakeAttention([row('health-1', 'blocking'), row('health-2', 'warning')])
    renderApp()

    const chip = await within(await rail()).findByRole('button', { name: /^Health.*1 Blocking, 1 Warning/ })
    await userEvent.click(chip)
    expect(url()).toBe('/health')
  })

  it('counts only health issues, not other Needs attention rows such as a Stuck download', async () => {
    fakeStatus(status())
    fakeAttention([row('health-1', 'warning'), row('stuck-7', 'warning'), row('silo-silent-3', 'warning'), row('stalled-exdev', 'warning')])
    renderApp()

    const chip = await within(await rail()).findByRole('button', { name: /^Health/ })
    expect(chip).toHaveAccessibleName(expect.stringMatching(/· 1 Warning$/))
  })

  it('says all checks are OK when nothing needs attention', async () => {
    fakeStatus(status())
    fakeAttention([])
    renderApp()

    expect(await within(await rail()).findByRole('button', { name: /All checks OK/ })).toBeInTheDocument()
  })
})

describe('the Overview on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 639'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the Health button in the phone top bar, and none at the top of the Overview', async () => {
    lowDiskAndBusySearch()
    fakeAttention([])
    renderApp()

    expect(await within(await topBar()).findByRole('button', { name: /^Health · All checks OK/ })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /^Health/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Searching|Wanted waiting|Nothing waiting/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /indexers?\b/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /full$/ })).not.toBeInTheDocument()
  })

  it('links the phone Health button to Health', async () => {
    fakeStatus(status())
    fakeAttention([row('health-1', 'blocking')])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /^Health · 1 Blocking/ }))
    expect(url()).toBe('/health')
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
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

const topBar = () => screen.findByRole('banner')
const chips = () => screen.findByRole('group', { name: 'Status' })

beforeEach(() => history.replaceState(null, '', '/'))

describe('Overview status chips', () => {
  it('replaces the Health and Searching sections', async () => {
    fakeStatus(status())
    renderApp()

    await chips()
    expect(screen.queryByRole('region', { name: /^Health/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Searching' })).not.toBeInTheDocument()
  })

  it('counts Needs attention rows by severity in the Health pill, and links to Activity Health', async () => {
    fakeStatus(status())
    fakeAttention([row('health-1', 'blocking'), row('health-2', 'warning')])
    renderApp()

    const chip = await within(await topBar()).findByRole('button', { name: /^Health.*1 Blocking, 1 Warning/ })
    await userEvent.click(chip)
    expect(url()).toBe('/activity/health')
  })

  it('counts only health issues, not other Needs attention rows such as a Stuck download', async () => {
    fakeStatus(status())
    fakeAttention([row('health-1', 'warning'), row('stuck-7', 'warning'), row('silo-silent-3', 'warning'), row('stalled-exdev', 'warning')])
    renderApp()

    const chip = await within(await topBar()).findByRole('button', { name: /^Health/ })
    expect(chip).toHaveAccessibleName(expect.stringMatching(/· 1 Warning$/))
  })

  it('says all checks are OK when nothing needs attention', async () => {
    fakeStatus(status())
    fakeAttention([])
    renderApp()

    expect(await within(await topBar()).findByRole('button', { name: /All checks OK/ })).toBeInTheDocument()
    expect(within(await chips()).queryByRole('button', { name: /^Health/ })).not.toBeInTheDocument()
  })

  it('shows what the search waits on and when the next pass is, and links to Background Jobs', async () => {
    fakeStatus(status())
    fakeSearch(
      searchStatus({
        due: { versions: 12, episodes: 0, upgrades: 0 },
        pass: { started_at: new Date().toISOString(), done: 3, total: 12 },
        next_pass_at: new Date(Date.now() + 14 * 60_000 + 5000).toISOString(),
      }),
    )
    renderApp()

    const chip = await within(await chips()).findByRole('button', { name: /Searching 3 of 12 Wanted · next pass in 14 min/ })
    await userEvent.click(chip)
    expect(url()).toBe('/activity/jobs')
  })

  it('says nothing is waiting when the search has nothing due', async () => {
    fakeStatus(status())
    fakeSearch(searchStatus({ next_pass_at: new Date(Date.now() + 3 * 60_000 + 5000).toISOString() }))
    renderApp()

    expect(await within(await chips()).findByRole('button', { name: /Nothing waiting · next pass in 3 min/ })).toBeInTheDocument()
  })

  it('counts the enabled indexers and the searches left today, and links to Activity Health', async () => {
    fakeStatus(status())
    renderApp()

    const chip = await within(await chips()).findByRole('button', { name: '2 indexers · 110 searches left today' })
    await userEvent.click(chip)
    expect(url()).toBe('/activity/health')
  })

  it('leaves the searches left out when no indexer reports a limit', async () => {
    fakeStatus(status({ indexers: [{ instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle }] }))
    renderApp()

    expect(await within(await chips()).findByRole('button', { name: '1 indexer' })).toBeInTheDocument()
  })

  it('has no Disk chip while every disk has room', async () => {
    fakeStatus(status())
    renderApp()

    await within(await chips()).findByRole('button', { name: /indexers/ })
    expect(within(await chips()).queryByRole('button', { name: /full/ })).not.toBeInTheDocument()
  })

  it('shows a Disk chip for a low disk, with how full it is, and links to Activity Health', async () => {
    fakeStatus(status({ disks: [{ path: '/media', free_bytes: 6 * GB, total_bytes: 100 * GB, low_free_bytes: 50 * GB }] }))
    renderApp()

    const chip = await within(await chips()).findByRole('button', { name: '/media 94% full' })
    await userEvent.click(chip)
    expect(url()).toBe('/activity/health')
  })
})

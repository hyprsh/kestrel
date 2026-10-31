// The tiles of the Health screen. They used to be the Overview's Health section, so these cover
// what each kind of tile shows; screen.test.tsx covers the screen itself.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Status = components['schemas']['SystemStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null }
const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [{ instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle }],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }],
  trash: { commit: 'abc1234def', committed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})

async function openHealth(s: Status) {
  server.use(http.get('/system/status', ({ response }) => response(200).json(s)))
  history.replaceState(null, '', '/health')
  renderApp()
  const panel = await screen.findByRole('region', { name: 'Health' })
  await within(panel).findByText(/SABnzbd|no download client/i)
  return panel
}

beforeEach(() => history.replaceState(null, '', '/'))

describe('Health tiles', () => {
  it("shows each indexer's daily budget and any pause, which are not failures", async () => {
    const panel = await openHealth(
      status({
        indexers: [
          { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle, search_used: 42, search_max: 100 },
          {
            instance_id: 12,
            name: 'Beta',
            state: 'ok',
            message: null,
            ...idle,
            search_used: 7,
            search_paused_until: '2026-10-18T14:05:00Z',
            grabs_paused: true,
            grabs_paused_until: '2026-10-18T14:05:00Z',
          },
          { instance_id: 13, name: 'Gamma', state: 'ok', message: null, ...idle, grab_used: 5, grab_max: 5, grabs_paused: true },
        ],
      }),
    )

    expect(panel).toHaveTextContent(/Alpha.*42 of 100 searches today/)
    expect(panel).toHaveTextContent(/Beta.*7 searches today/)
    expect(panel).toHaveTextContent(/Beta.*Searches paused until/)
    expect(panel).toHaveTextContent(/Beta.*Grabs paused until/)
    expect(panel).toHaveTextContent(/Gamma.*Grabs paused \(5 of 5 downloads used\)/)
    expect(panel).not.toHaveTextContent(/failing/)
  })

  it('says when Pause Grabs is on', async () => {
    const paused = await openHealth(status({ grabs_paused: true }))
    expect(paused).toHaveTextContent(/automatic Grabs are paused/i)
  })

  it('says nothing about pausing while grabs run', async () => {
    const panel = await openHealth(status())
    expect(panel).not.toHaveTextContent(/automatic Grabs are paused/i)
  })

  it('says when no download client is set up', async () => {
    const panel = await openHealth(status({ download_client: { state: 'none', name: null, instance_id: null, message: null }, indexers: [] }))
    expect(panel).toHaveTextContent(/no download client/i)
  })

  it('draws the search budget and the disk as meters, amber when paused or low', async () => {
    const panel = await openHealth(
      status({
        indexers: [
          { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle, search_used: 42, search_max: 100 },
          { instance_id: 12, name: 'Beta', state: 'ok', message: null, ...idle, search_used: 100, search_max: 100, search_paused_until: '2026-10-18T14:05:00Z' },
        ],
        disks: [
          { path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 },
          { path: '/media', free_bytes: 30 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 },
        ],
      }),
    )

    const alpha = within(panel).getByRole('progressbar', { name: 'Alpha searches used today' })
    expect(alpha).toHaveAttribute('aria-valuenow', '42')
    expect(alpha).toHaveAttribute('aria-valuemax', '100')
    expect(within(panel).getByRole('progressbar', { name: '/data space used' })).toBeInTheDocument()
    expect(within(panel).getByRole('progressbar', { name: '/media space used' })).toBeInTheDocument()

    const tile = (name: string) => within(panel).getByText(name).closest('li')!
    expect(tile('Beta')).toHaveTextContent('paused')
    expect(tile('/media')).toHaveTextContent('low')
    expect(tile('/media')).toHaveTextContent('30 GB free of 1 TB')
    expect(tile('/data')).not.toHaveTextContent('low')
  })

  it('shows an available update as a tile that goes to About', async () => {
    const panel = await openHealth(status({ update: { version: '0.9.0', url: 'https://example.test/r' } }))

    const tile = within(panel).getByText('Kestrel 0.9.0 available').closest('li')!
    expect(tile).toHaveTextContent('update')
    expect(within(tile).getByRole('button', { name: 'About' })).toBeInTheDocument()
  })
})

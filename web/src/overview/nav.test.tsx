import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { fakeRequests, request } from '../test/requests'
import { lastPassOf, passOf } from '../test/search'
import { server } from '../test/server'
import { RecentlyAdded } from './ComingRecent'

type Recent = components['schemas']['RecentItem']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const recent = (over: Partial<Recent>): Recent => ({
  title_id: 7,
  title: 'Paddington',
  year: 2014,
  kind: 'movie',
  has_poster: false,
  slot: 'standard',
  release_name: 'Paddington.2014.1080p.BluRay-GRP',
  score: 250,
  score_delta: null,
  files: 1,
  is_upgrade: false,
  imported_at: '2026-10-17T12:00:00Z',
  ...over,
})

describe('Overview rows', () => {
  it('shows the Slot and age of a recent Import in its row', () => {
    // The list alone, from a filled cache: nothing to wait for, so no boot of the whole App
    // to race on a loaded machine.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['titles', 'recent'], {
      items: [recent({ is_upgrade: true, score_delta: 150 }), recent({ title_id: 8, title: 'Arrival', slot: '4k' })],
      total: 2,
    })
    render(
      <QueryClientProvider client={client}>
        <RecentlyAdded onOpenTitle={() => {}} nav={{ base: 0, sel: -1, select: () => {} }} />
      </QueryClientProvider>,
    )

    const [first, second] = within(screen.getByRole('region', { name: 'Recently added · 2' })).getAllByRole('listitem')
    expect(first).toHaveTextContent('Paddington')
    expect(second).toHaveTextContent('Arrival')
    expect(second).toHaveTextContent('4K')
  })

  it('moves one selection with j through Happening now, Recently added, Recent requests and Coming this week, in reading order', async () => {
    server.use(
      http.get('/attention', ({ response }) =>
        response(200).json({
          count: 1,
          severity: 'warning',
          rows: [
            {
              id: 'health-2',
              severity: 'warning',
              kind: 'exdev',
              subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null },
              message: 'Imports copy instead of moving',
              since: '2026-10-18T09:30:00Z',
              count: 1,
              actions: [],
            },
          ],
          long_missing: { count: 0, items: [] },
          originals: { count: 0, items: [] },
        }),
      ),
      http.get('/queue', ({ response }) =>
        response(200).json({
          items: [
            {
              grab_id: 1,
              title_id: 5,
              has_poster: false,
              version_id: 11,
              title: 'Heat',
              year: 1995,
              kind: 'movie',
              slot: 'standard',
              episodes: [],
              release_name: 'Heat.1995-GRP',
              indexer: 'NZBgeek',
              size: 10,
              score: 0,
              phase: 'downloading',
              phase_since: '2026-10-18T09:30:00Z',
              grabbed_at: '2026-10-18T09:30:00Z',
              bytes_total: 10,
              bytes_left: 5,
              eta: null,
              is_upgrade: false,
              score_delta: null,
              stuck: null,
            },
          ],
        }),
      ),
      http.get('/upcoming', ({ response }) =>
        response(200).json({
          from: dayString(),
          to: dayString(6),
          items: [
            {
              date: dayString(1),
              kind: 'movie',
              title_id: 9,
              title: 'Dune',
              year: 2021,
              release_type: 'digital',
              season: null,
              episode: null,
              episode_name: null,
              searchable_from: null,
              released: true,
            },
          ],
        }),
      ),
      http.get('/recent', ({ response }) => response(200).json({ items: [recent({})], total: 1 })),
    )
    fakeRequests([request({ title: 'Severance', title_id: 3 })])
    renderApp()
    await screen.findByText('Imports copy instead of moving')
    await screen.findByText('Dune')
    await screen.findByText('Paddington')
    await screen.findByText('Severance')

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toHaveTextContent('Imports copy instead of moving')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Heat')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Severance')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Dune')
  })

  it('runs through the groups of Happening now, and Enter on Long Missing expands it', async () => {
    server.use(
      http.get('/attention', ({ response }) =>
        response(200).json({
          count: 0,
          severity: null,
          rows: [],
          long_missing: {
            count: 1,
            items: [{ title_id: 3, title: 'Ancient Film', version_id: 31, slot: 'standard', profile: 'hd-primary', wanted_since: '2026-01-01T00:00:00Z', last_failure: null }],
          },
          originals: { count: 0, items: [] },
        }),
      ),
      http.get('/recent', ({ response }) => response(200).json({ items: [recent({})], total: 1 })),
    )
    renderApp()
    await screen.findByText('Paddington')

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toHaveTextContent('1 Version long missing')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText(/Ancient Film/)).toBeInTheDocument()
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
  })

  it('shows the running search pass in Happening now, and j runs through it', async () => {
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 4, episodes: 0, upgrades: 0 },
          pass: passOf({
            done: 1,
            total: 4,
            releases_seen: 30,
            grabbed: 2,
            current: { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: 'Standard', season: 5, episodes: [], releases_seen: 12 },
          }),
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
      http.get('/recent', ({ response }) => response(200).json({ items: [recent({})], total: 1 })),
    )
    renderApp()
    const row = (await screen.findByText('Searching Wanted')).closest<HTMLElement>('[data-nav]')!

    expect(row).toHaveTextContent('Searching Wanted')
    expect(row).toHaveTextContent('Now: Breaking Bad · S05 · Standard · 12 releases')
    expect(row).toHaveTextContent('1 of 4 Wanted')
    expect(row).toHaveTextContent('30 releases checked · 2 Grabs so far')
    expect(within(row).getByRole('progressbar', { name: 'Search progress' })).toBeInTheDocument()
    expect(screen.queryByText(/nothing is downloading/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Watch in Health' })).toBeInTheDocument()

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toBe(row)
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
  })

  const fakeLastPass = (last: ReturnType<typeof lastPassOf>) =>
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({ due: { versions: 0, episodes: 0, upgrades: 0 }, pass: null, next_pass_at: null, last_pass: last, upgrades_per_pass: 5, indexers: [] }),
      ),
    )

  it('keeps a pass that has just finished as a row with its result, until dismissed', async () => {
    fakeLastPass(lastPassOf({ searched: 4, releases_seen: 37, grabbed: 1 }))
    renderApp()
    const row = (await screen.findByText('Search done: 4 searched · 37 releases checked · 1 Grab')).closest<HTMLElement>('[data-nav]')!
    expect(screen.queryByText(/nothing is downloading/i)).not.toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/^Search done/)).not.toBeInTheDocument()
  })

  it('drops the finished row a minute after the pass ended', async () => {
    fakeLastPass(lastPassOf({ finished_at: new Date(Date.now() - 59_700).toISOString() }))
    renderApp()
    expect(await screen.findByText(/^Search done/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/^Search done/)).not.toBeInTheDocument(), { timeout: 2000 })
  })

  it('shows no finished row for a pass that ended long ago', async () => {
    fakeLastPass(lastPassOf({ finished_at: new Date(Date.now() - 5 * 60_000).toISOString() }))
    renderApp()
    await screen.findByText(/nothing is downloading/i)
    expect(screen.queryByText(/^Search done/)).not.toBeInTheDocument()
  })

  it('has no search row when no pass runs', async () => {
    renderApp()
    await screen.findByText(/nothing is downloading/i)

    expect(screen.queryByText(/Searching/)).not.toBeInTheDocument()
  })
})

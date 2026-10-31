import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { fakeRequests, request } from '../test/requests'
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
  it('shows the Slot and age of a recent Import under its poster', () => {
    // The shelf alone, from a filled cache: nothing to wait for, so no boot of the whole App
    // to race on a loaded machine.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['titles', 'recent'], {
      items: [recent({ is_upgrade: true, score_delta: 150 }), recent({ title_id: 8, title: 'Arrival', slot: '4k' })],
      total: 2,
    })
    render(
      <QueryClientProvider client={client}>
        <RecentlyAdded onOpenTitle={() => {}} nav={{ base: 0, sel: -1, select: () => {} }} shelf={{ ref: () => {}, count: 8 }} />
      </QueryClientProvider>,
    )

    const [first, second] = within(screen.getByRole('region', { name: 'Recently added · 2' })).getAllByRole('listitem')
    expect(first).toHaveTextContent('Paddington')
    expect(second).toHaveTextContent('Arrival')
    expect(second).toHaveTextContent('4K')
  })

  it('moves one selection with j through Needs attention, Downloading now, Recent requests, Recently added and Coming this week', async () => {
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
    expect(current()).toHaveTextContent('Severance')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Dune')
  })
})

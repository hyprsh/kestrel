import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Recent = components['schemas']['RecentItem']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const recent = (over: Partial<Recent>): Recent => ({
  title_id: 7,
  title: 'Paddington',
  year: 2014,
  kind: 'movie',
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
  it('shows the release name and the score delta of a recent Import, or "new"', async () => {
    server.use(
      http.get('/recent', ({ response }) =>
        response(200).json({
          items: [
            recent({ is_upgrade: true, score_delta: 150 }),
            recent({ title_id: 8, title: 'Arrival', release_name: 'Arrival.2016.2160p-GRP', slot: '4k' }),
          ],
        }),
      ),
    )
    renderApp()

    const section = await screen.findByRole('region', { name: /recently added/i })
    const [upgrade, first] = await within(section).findAllByRole('listitem')
    expect(upgrade).toHaveTextContent('Paddington.2014.1080p.BluRay-GRP')
    expect(upgrade).toHaveTextContent('+150')
    expect(first).toHaveTextContent('Arrival.2016.2160p-GRP')
    expect(first).toHaveTextContent('new')
  })

  it('moves one selection with j through Needs attention, Downloading now, Coming this week and Recently added', async () => {
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
        }),
      ),
      http.get('/queue', ({ response }) =>
        response(200).json({
          items: [
            {
              grab_id: 1,
              title_id: 5,
              version_id: 11,
              title: 'Heat',
              year: 1995,
              slot: 'standard',
              episodes: [],
              release_name: 'Heat.1995-GRP',
              phase: 'downloading',
              bytes_total: 10,
              bytes_left: 5,
              eta: null,
              is_upgrade: false,
              score_delta: null,
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
      http.get('/recent', ({ response }) => response(200).json({ items: [recent({})] })),
    )
    renderApp()
    await screen.findByText('Imports copy instead of moving')
    await screen.findByText('Dune')
    await screen.findByText('Paddington.2014.1080p.BluRay-GRP')

    const current = () => document.querySelector('[aria-current="true"]')
    expect(current()).toHaveTextContent('Imports copy instead of moving')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Heat')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Dune')
    await userEvent.keyboard('j')
    expect(current()).toHaveTextContent('Paddington')
  })
})

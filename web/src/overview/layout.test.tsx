import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { dayString } from '../api/upcoming'
import { http } from '../test/handlers'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Status = components['schemas']['SystemStatus']

const idle = { search_used: 0, search_max: null, grab_used: null, grab_max: null, search_paused_until: null, grabs_paused: false, grabs_paused_until: null }

const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [{ instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle }],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }],
  trash: { commit: 'abc1234def', committed_at: new Date().toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})

const fakeStatus = (s: Status) => server.use(http.get('/system/status', ({ response }) => response(200).json(s)))

describe('Overview layout', () => {
  it('puts Health after every other section', async () => {
    fakeStatus(status())
    renderApp()

    await screen.findByRole('button', { name: /^Health ·/ })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.at(-1)).toMatch(/^Health/)
    expect(headings).toEqual(expect.arrayContaining(['Needs attention', 'Downloading now', 'Recently added', 'Coming this week', 'Recent requests']))
  })

  it('shows a Skeleton in the summary line while the status loads, not in the collapsed section', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.get('/system/status', async ({ response }) => {
        await gate
        return response(200).json(status())
      }),
    )
    renderApp()

    const toggle = await screen.findByRole('button', { name: /^Health/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.querySelector('.hy-skeleton')).not.toBeNull()
    expect(toggle.textContent).not.toMatch(/all good|failing/)
    expect(screen.queryByRole('region', { name: /^Health/ })?.querySelector('.hy-skeleton') ?? null).toBeNull() // nothing hidden in the collapsed panel

    release()
    expect(await screen.findByRole('button', { name: 'Health · all good' })).toBeInTheDocument()
  })

  it('shows Health as its summary line only while every check is ok, and opens it on a click', async () => {
    fakeStatus(status())
    renderApp()

    const toggle = await screen.findByRole('button', { name: 'Health · all good' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('SABnzbd')).not.toBeVisible()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('SABnzbd')).toBeVisible()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens Health on load with the failure first when a check fails', async () => {
    fakeStatus(status({ download_client: { state: 'failing', name: 'SABnzbd', instance_id: 3, message: 'Connection refused' } }))
    renderApp()

    expect(await screen.findByRole('button', { name: 'Health · 1 failing' })).toHaveAttribute('aria-expanded', 'true')
    const health = screen.getByRole('region', { name: 'Health · 1 failing' })
    expect(within(health).getByText('Connection refused')).toBeVisible()
    expect(within(health).getAllByRole('listitem')[0]).toHaveTextContent('SABnzbd')
  })
})

describe('Overview posters', () => {
  it('shows a poster on each Coming this week row', async () => {
    server.use(
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
              has_poster: true,
            },
          ],
        }),
      ),
    )
    renderApp()

    const row = (await within(await screen.findByRole('region', { name: /^Coming this week/ })).findAllByRole('listitem'))[0]
    expect(row.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/9/poster'))
  })

  it('shows a poster, or its placeholder, on each Recently added row', async () => {
    const item = { kind: 'movie', slot: 'standard', release_name: 'X-GRP', score: 1, score_delta: null, files: 1, is_upgrade: false, imported_at: '2026-10-17T12:00:00Z', year: 2020 } as const
    server.use(
      http.get('/recent', ({ response }) =>
        response(200).json({
          total: 2,
          items: [
            { ...item, title_id: 7, title: 'With', has_poster: true },
            { ...item, title_id: 8, title: 'Without', has_poster: false },
          ],
        }),
      ),
    )
    fakeQueue([queueItem()])
    renderApp()

    const [a, b] = await within(await screen.findByRole('region', { name: /^Recently added/ })).findAllByRole('listitem')
    expect(a.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/7/poster'))
    expect(b.querySelector('[data-poster]')).toBeInTheDocument()
    expect(b.querySelector('img')).not.toBeInTheDocument()
  })
})

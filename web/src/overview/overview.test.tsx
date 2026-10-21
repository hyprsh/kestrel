import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type QueueItem = components['schemas']['QueueItem']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  grab_id: 1,
  title_id: 5,
  has_poster: false,
  version_id: 11,
  title: 'Paddington',
  year: 2014,
  slot: 'standard',
  episodes: [],
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  phase: 'downloading',
  bytes_total: 8000,
  bytes_left: 2000,
  eta: 125,
  is_upgrade: false,
  score_delta: null,
  ...over,
})

function fakeQueue(items: QueueItem[]) {
  const state = { items, cancels: [] as { id: string; body: unknown }[] }
  server.use(
    http.get('/queue', ({ response }) => response(200).json({ items: state.items })),
    http.post('/grabs/{id}/cancel', async ({ params, request, response }) => {
      const text = await request.clone().text()
      state.cancels.push({ id: String(params.id), body: text ? JSON.parse(text) : null })
      state.items = state.items.filter((i) => String(i.grab_id) !== String(params.id))
      return response(204).empty()
    }),
  )
  return state
}

describe('Overview', () => {
  it('is the home screen and shows "Downloading now" with phase, progress, ETA and Slot', async () => {
    fakeQueue([item()])
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    const row = await within(section).findByRole('listitem')
    expect(row).toHaveTextContent('Paddington')
    expect(row).toHaveTextContent('2014')
    expect(row).toHaveTextContent('Standard')
    expect(row).toHaveTextContent('Downloading')
    expect(row).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(row).toHaveTextContent('75%')
    expect(row).toHaveTextContent('2 min left')
    expect(within(row).queryByText('Upgrade')).not.toBeInTheDocument()
  })

  it('badges an Upgrade with how many points it gains', async () => {
    fakeQueue([item({ is_upgrade: true, score_delta: 120 })])
    renderApp()

    const row = await screen.findByRole('listitem')

    expect(within(row).getByText('Upgrade')).toBeInTheDocument()
    expect(row).toHaveTextContent('+120')
  })

  it('shows a download that finished as importing, and a paused or queued one as such', async () => {
    fakeQueue([
      item({ grab_id: 1, phase: 'importing', bytes_left: 0, eta: null }),
      item({ grab_id: 2, phase: 'paused', release_name: 'B', eta: null }),
      item({ grab_id: 3, phase: 'queued', release_name: 'C', bytes_total: 0, bytes_left: 0, eta: null }),
    ])
    renderApp()

    const rows = await screen.findAllByRole('listitem')

    expect(rows[0]).toHaveTextContent('Importing')
    expect(rows[1]).toHaveTextContent('Paused')
    expect(rows[2]).toHaveTextContent('Queued')
    expect(within(rows[2]).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says so when nothing is downloading', async () => {
    fakeQueue([])
    renderApp()

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
  })

  it('cancels a Grab without blocklisting and the row goes away', async () => {
    const state = fakeQueue([item()])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
    expect(state.cancels).toEqual([{ id: '1', body: { blocklist: false } }])
  })

  it('cancels and blocklists in one step', async () => {
    const state = fakeQueue([item()])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel and blocklist' }))

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
    expect(state.cancels).toEqual([{ id: '1', body: { blocklist: true } }])
  })
})

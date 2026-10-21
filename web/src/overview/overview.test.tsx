import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem as item } from '../test/queue'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

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

  it("shows the Title's poster as a small lazy thumbnail", async () => {
    fakeQueue([item({ has_poster: true })])
    renderApp()

    const row = await screen.findByRole('listitem')
    const poster = row.querySelector('img')
    expect(poster).toHaveAttribute('src', expect.stringContaining('/titles/5/poster'))
    expect(poster).toHaveAttribute('loading', 'lazy')
  })

  it('shows the placeholder for a Title without a poster, and no poster for a deleted Title', async () => {
    fakeQueue([item({ grab_id: 1 }), item({ grab_id: 2, title_id: null, title: '', year: null, release_name: 'Gone.2001-GRP' })])
    renderApp()

    const [plain, deleted] = await screen.findAllByRole('listitem')
    expect(plain.querySelector('[data-poster]')).toBeInTheDocument()
    expect(plain.querySelector('img')).not.toBeInTheDocument()
    expect(deleted).toHaveTextContent('Deleted Title')
    expect(deleted.querySelector('[data-poster]')).not.toBeInTheDocument()
  })

  it('opens the Title from its name', async () => {
    fakeQueue([item({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Paddington' }))

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('opens the Title from its poster', async () => {
    fakeQueue([item({ title_id: 1, has_poster: true })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const listItem = await screen.findByRole('listitem')
    await userEvent.click(listItem.querySelector('img')!)

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('does not open a deleted Title', async () => {
    fakeQueue([item({ title_id: null, title: '' })])
    renderApp()

    const listItem = await screen.findByRole('listitem')
    expect(within(listItem).queryByRole('button', { name: 'Deleted Title' })).not.toBeInTheDocument()
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

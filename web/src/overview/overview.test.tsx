import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { http } from '../test/handlers'
import { fakeQueue, queueItem as item } from '../test/queue'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** Cancel is in the row's menu. */
async function cancel(label: string) {
  await userEvent.click(await screen.findByRole('button', { name: /^Actions for / }))
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

describe('Overview', () => {
  it('is the home screen and shows "Downloading now" as one line per Grab: the Title, a progress bar, the percentage and the time left', async () => {
    fakeQueue([item()])
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    const row = await within(section).findByRole('listitem')
    expect(row).toHaveTextContent('Paddington')
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(row).toHaveTextContent('75% · 2 min')
    // The release name, byte counts and Slot are on Activity.
    expect(row).not.toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')
    expect(row).not.toHaveTextContent('Standard')
    expect(within(row).queryByText('Upgrade')).not.toBeInTheDocument()
  })

  it('names the episodes of a Series Grab after the Title', async () => {
    fakeQueue([item({ title: 'Severance', kind: 'series', episodes: ['S02E04'] })])
    renderApp()

    const row = await within(await screen.findByRole('region', { name: /downloading now/i })).findByRole('listitem')
    expect(row).toHaveTextContent('Severance S02E04')
  })

  it('links "All activity" to Activity', async () => {
    fakeQueue([item()])
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'All activity →' }))

    expect(location.pathname).toBe('/activity')
  })

  it("shows the Title's poster as a small lazy thumbnail", async () => {
    fakeQueue([item({ has_poster: true })])
    renderApp()

    const row = await within(await screen.findByRole('region', { name: /downloading now/i })).findByRole('listitem')
    const poster = row.querySelector('img')
    expect(poster).toHaveAttribute('src', expect.stringContaining('/titles/5/poster'))
    expect(poster).toHaveAttribute('loading', 'lazy')
  })

  it('shows the placeholder for a Title without a poster, and no poster for a deleted Title', async () => {
    fakeQueue([item({ grab_id: 1 }), item({ grab_id: 2, title_id: null, title: '', year: null, release_name: 'Gone.2001-GRP' })])
    renderApp()

    const [plain, deleted] = await within(await screen.findByRole('region', { name: /downloading now/i })).findAllByRole('listitem')
    expect(plain.querySelector('[data-poster]')).toBeInTheDocument()
    expect(plain.querySelector('img')).not.toBeInTheDocument()
    expect(deleted).toHaveTextContent('Deleted Title')
    expect(deleted.querySelector('[data-poster]')).not.toBeInTheDocument()
  })

  it('opens the Title from its row', async () => {
    fakeQueue([item({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    const [listItem] = await within(section).findAllByRole('listitem')
    await userEvent.click(within(listItem).getAllByRole('button', { hidden: true })[0]) // the row's whole-row button

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('does not open a deleted Title', async () => {
    fakeQueue([item({ title_id: null, title: '' })])
    renderApp()

    const listItem = await within(await screen.findByRole('region', { name: /downloading now/i })).findByRole('listitem')
    await userEvent.click(within(listItem).getAllByRole('button', { hidden: true })[0])
    expect(screen.queryByRole('region', { name: /deleted title/i })).not.toBeInTheDocument()
  })

  it('shows a download that finished as importing, and a paused, queued or post-processing one as such, without a bar when the size is unknown', async () => {
    fakeQueue([
      item({ grab_id: 1, phase: 'importing', bytes_left: 0, eta: null }),
      item({ grab_id: 2, phase: 'paused', release_name: 'B', eta: null }),
      item({ grab_id: 3, phase: 'queued', release_name: 'C', bytes_total: 0, bytes_left: 0, eta: null }),
      item({ grab_id: 4, phase: 'post_processing', release_name: 'D', bytes_left: 0, eta: null }),
    ])
    renderApp()

    const rows = await within(await screen.findByRole('region', { name: /downloading now/i })).findAllByRole('listitem')

    expect(rows[0]).toHaveTextContent('Importing')
    expect(rows[1]).toHaveTextContent('Paused')
    expect(rows[2]).toHaveTextContent('Queued')
    expect(within(rows[2]).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(rows[3]).toHaveTextContent('Post-processing')
  })

  it('says so when nothing is downloading', async () => {
    fakeQueue([])
    renderApp()

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
  })

  it('cancels a Grab without blocklisting and the row goes away', async () => {
    const state = fakeQueue([item()])
    renderApp()

    await cancel('Cancel')

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
    expect(state.cancels).toEqual([{ id: '1', body: { blocklist: false } }])
    expect(await findToast('Grab cancelled')).toBeInTheDocument()
  })

  it('cancels and blocklists in one step', async () => {
    const state = fakeQueue([item()])
    renderApp()

    await cancel('Cancel and blocklist')

    expect(await screen.findByText(/nothing is downloading/i)).toBeInTheDocument()
    expect(state.cancels).toEqual([{ id: '1', body: { blocklist: true } }])
    expect(await findToast('Grab cancelled and its Release blocklisted')).toBeInTheDocument()
  })

  it('says in a Toast when a Grab could not be cancelled, and keeps the row', async () => {
    fakeQueue([item()])
    server.use(
      http.post('/grabs/{id}/cancel', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'client offline' }, { status: 500 })),
    )
    renderApp()

    await cancel('Cancel')

    expect(await findToast('Could not cancel the Grab: client offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Actions for Paddington/ })).toBeInTheDocument()
  })
})

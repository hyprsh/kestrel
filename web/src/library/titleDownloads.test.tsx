import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { fakeSeries } from '../test/series'
import { openVersionMenu } from '../test/titleHeader'
import { findToast } from '../test/toasts'

async function openPaddington(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  fakeLibrary([row(1, 'Paddington', 'Paddington'), row(2, 'Heat', 'Heat', { year: 1995 })])
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  return { pane, row: await within(pane).findByRole('listitem', { name: 'Standard' }) }
}

describe("a Title's downloads on its page", () => {
  it("shows a Movie Version's Grab in its own row: phase, percent, time left, progress and Release, and not another Title's", async () => {
    fakeQueue([
      queueItem({ grab_id: 1, title_id: 1, slot: 'standard', release_name: 'Paddington.2014.1080p-GRP' }),
      queueItem({ grab_id: 2, title_id: 2, title: 'Heat', release_name: 'Heat.1995.1080p-GRP' }),
    ])
    const { pane, row: hd } = await openPaddington()

    expect(await within(hd).findByText('Downloading · 75% · 2 min left')).toBeInTheDocument()
    expect(within(hd).getByRole('progressbar', { name: 'Standard download progress' })).toHaveAttribute('aria-valuenow', '75')
    expect(within(hd).getByText(/Paddington\.2014\.1080p-GRP/)).toBeInTheDocument()
    expect(within(pane).queryByText(/Heat/)).not.toBeInTheDocument()
    expect(within(pane).queryByRole('region', { name: 'Downloading' })).not.toBeInTheDocument()
    expect(within(pane).getByText('Standard downloading · 75%')).toBeInTheDocument()
  })

  it("shows a Series Slot's downloads on its card, with the episodes, percent and time left", async () => {
    fakeSeries()
    fakeQueue([queueItem({ grab_id: 1, title_id: 5, slot: '4k', episodes: ['S05E09', 'S05E10'] })])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /breaking bad/i })

    const uhd = await within(pane).findByRole('listitem', { name: '4K' })
    expect(await within(uhd).findByText('Downloading S05E09, S05E10')).toBeInTheDocument()
    expect(within(uhd).getByText('75% · 2 min left')).toBeInTheDocument()
    expect(within(pane).getByRole('listitem', { name: 'Standard' })).not.toHaveTextContent('Downloading')
  })

  it('has no download line when nothing of this Title is downloading', async () => {
    fakeQueue([queueItem({ title_id: 2, title: 'Heat' })])
    const { row: hd } = await openPaddington()

    await within(hd)
      .findByText('Wanted for 1 day', { exact: false })
      .catch(() => undefined)
    expect(within(hd).queryByText(/Downloading/)).not.toBeInTheDocument()
  })

  it('cancels a Grab with the row’s one action', async () => {
    const state = fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const { row: hd } = await openPaddington()

    await userEvent.click(await within(hd).findByRole('button', { name: 'Cancel the Standard download' }))

    expect(state.cancels).toEqual([{ id: '7', body: { blocklist: false } }])
    expect(await findToast('Grab cancelled')).toBeInTheDocument()
    await expect.poll(() => within(hd).queryByText(/Downloading/)).toBeNull()
  })

  it('cancels and blocklists from the Version menu', async () => {
    const state = fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const { pane, row: hd } = await openPaddington()
    await within(hd).findByText(/Downloading/)

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel and blocklist' }))

    expect(state.cancels).toEqual([{ id: '7', body: { blocklist: true } }])
    expect(await findToast('Grab cancelled and its Release blocklisted')).toBeInTheDocument()
  })

  it('follows the live queue', async () => {
    fakeQueue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { row: hd } = await openPaddington(client)
    await within(hd).findByText(/Wanted/)

    // What the stream's `queue` frames do (live/stream.ts).
    act(() => client.setQueryData(['queue'], [queueItem({ title_id: 1, release_name: 'Paddington.2014.720p-GRP' })]))

    expect(await within(hd).findByText(/Paddington\.2014\.720p-GRP/)).toBeInTheDocument()
  })
})

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

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
  const item = await within(pane).findByRole('listitem', { name: 'Standard' })
  return { pane, row: item }
}

describe("a Title's downloads on its page", () => {
  it("shows a Movie Version's Grab in its card: Release, percent and time left, and not another Title's", async () => {
    fakeQueue([
      queueItem({ grab_id: 1, title_id: 1, slot: 'standard', release_name: 'Paddington.2014.1080p-GRP' }),
      queueItem({ grab_id: 2, title_id: 2, title: 'Heat', release_name: 'Heat.1995.1080p-GRP' }),
    ])
    const { pane, row: hd } = await openPaddington()

    expect(await within(hd).findByText('Paddington.2014.1080p-GRP')).toBeInTheDocument()
    expect(within(hd).getByText(/^Downloading 75% · .* left/)).toHaveTextContent('2 min left')
    expect(within(pane).queryByText(/Heat/)).not.toBeInTheDocument()
    expect(within(pane).queryByRole('region', { name: 'Downloading' })).not.toBeInTheDocument()
  })

  it("shows a Series Slot's downloads on its column head, with the episodes, percent and time left", async () => {
    fakeSeries()
    fakeQueue([queueItem({ grab_id: 1, title_id: 5, slot: '4k', episodes: ['S05E09', 'S05E10'] })])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /breaking bad/i })

    const uhd = await within(pane).findByRole('columnheader', { name: '4K' })
    expect(await within(uhd).findByText(/^Downloading S05E09–E10 · 75%/)).toHaveTextContent('2 min left')
    expect(within(pane).getByRole('columnheader', { name: 'Standard' })).not.toHaveTextContent('Downloading')
  })

  it('has no download state when nothing of this Title is downloading', async () => {
    fakeQueue([queueItem({ title_id: 2, title: 'Heat' })])
    const { row: hd } = await openPaddington()

    expect(within(hd).queryByText(/Downloading/)).not.toBeInTheDocument()
    expect(within(hd).queryByRole('button', { name: 'Open in Activity' })).not.toBeInTheDocument()
  })

  it('cancels a Grab from the Version menu', async () => {
    const state = fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const { pane, row: hd } = await openPaddington()
    await within(hd).findByText(/Downloading/)

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel Download' }))

    expect(state.cancels).toEqual([{ id: '7', body: { blocklist: false } }])
    expect(await findToast('Grab cancelled')).toBeInTheDocument()
  })

  it('has Open in Activity as the main action of a downloading card', async () => {
    fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const { row: hd } = await openPaddington()

    expect(await within(hd).findByRole('button', { name: 'Open in Activity' })).toBeInTheDocument()
    expect(within(hd).queryByRole('button', { name: 'Cancel and Block' })).not.toBeInTheDocument()
  })

  it('cancels and blocklists from the Version menu', async () => {
    const state = fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const { pane, row: hd } = await openPaddington()
    await within(hd).findByText(/Downloading/)

    await openVersionMenu(pane, 'Standard')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel and Blocklist' }))

    expect(state.cancels).toEqual([{ id: '7', body: { blocklist: true } }])
    expect(await findToast('Grab cancelled and its Release blocklisted')).toBeInTheDocument()
  })

  it('follows the live queue', async () => {
    fakeQueue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { row: hd } = await openPaddington(client)
    await within(hd).findByText('Not searched yet')

    // What the stream's `queue` frames do (live/stream.ts).
    act(() => client.setQueryData(['queue'], [queueItem({ title_id: 1, release_name: 'Paddington.2014.720p-GRP' })]))

    expect(await within(hd).findByText(/Paddington\.2014\.720p-GRP/)).toBeInTheDocument()
  })
})

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'

async function openPaddington(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  fakeLibrary([row(1, 'Paddington', 'Paddington'), row(2, 'Heat', 'Heat', { year: 1995 })])
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('region', { name: /paddington/i })
}

describe("a Title's downloads on its page", () => {
  it("lists only this Title's Grabs, with Slot, episodes, Release, phase and progress", async () => {
    fakeQueue([
      queueItem({ grab_id: 1, title_id: 1, slot: '4k', episodes: ['S01E01-E08'], release_name: 'Paddington.2014.2160p-GRP' }),
      queueItem({ grab_id: 2, title_id: 2, title: 'Heat', release_name: 'Heat.1995.1080p-GRP' }),
    ])
    const pane = await openPaddington()

    const section = await within(pane).findByRole('region', { name: 'Downloading' })
    const rows = await within(section).findAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('4K')
    expect(rows[0]).toHaveTextContent('S01E01-E08')
    expect(rows[0]).toHaveTextContent('Paddington.2014.2160p-GRP')
    expect(rows[0]).toHaveTextContent('Downloading')
    expect(within(rows[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(section).not.toHaveTextContent('Heat')
  })

  it("names the list of this Title's Grabs, one item each with its Cancel actions", async () => {
    fakeQueue([queueItem({ grab_id: 1, title_id: 1 })])
    const pane = await openPaddington()

    const list = await within(pane).findByRole('list', { name: 'Downloading' })
    const [row] = within(list).getAllByRole('listitem')
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(within(row).getByRole('button', { name: 'Cancel and blocklist' })).toBeEnabled()
  })

  it('has no Downloading section when nothing of this Title is downloading', async () => {
    fakeQueue([queueItem({ title_id: 2, title: 'Heat' })])
    const pane = await openPaddington()

    await within(pane).findByText('About Paddington.')
    expect(within(pane).queryByRole('region', { name: 'Downloading' })).not.toBeInTheDocument()
  })

  it('cancels a Grab from the Title page', async () => {
    const state = fakeQueue([queueItem({ grab_id: 7, title_id: 1 })])
    const pane = await openPaddington()

    const section = await within(pane).findByRole('region', { name: 'Downloading' })
    await userEvent.click(within(section).getByRole('button', { name: 'Cancel and blocklist' }))

    expect(state.cancels).toEqual([{ id: '7', body: { blocklist: true } }])
    await expect.poll(() => within(pane).queryByRole('region', { name: 'Downloading' })).toBeNull()
  })

  it('follows the live queue', async () => {
    fakeQueue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pane = await openPaddington(client)
    await within(pane).findByText('About Paddington.')

    // What the stream's `queue` frames do (live/stream.ts).
    act(() => client.setQueryData(['queue'], [queueItem({ title_id: 1, release_name: 'Paddington.2014.720p-GRP' })]))

    const section = await within(pane).findByRole('region', { name: 'Downloading' })
    expect(section).toHaveTextContent('Paddington.2014.720p-GRP')
  })
})

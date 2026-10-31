import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeQueue, queueItem } from '../test/queue'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openActivity() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

describe('Activity shows a Stuck download', () => {
  it('keeps it in its stage and says how long it made no progress, in words', async () => {
    fakeQueue([
      queueItem({ grab_id: 1, phase: 'downloading', stuck: { reason: 'no_progress', since: minutesAgo(80) } }),
      queueItem({ grab_id: 2, phase: 'downloading', release_name: 'Fine-GRP' }),
    ])
    await openActivity()

    const region = await screen.findByRole('region', { name: 'Downloading · 2' })
    const [stuck, fine] = within(region).getAllByRole('listitem')

    expect(stuck).toHaveTextContent('Stuck: no progress for 1 h 20 min')
    expect(fine).not.toHaveTextContent(/stuck/i)
    expect(stuck).not.toHaveTextContent(/stalled/i)
  })

  it('says a paused job is paused in the download client', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'paused', stuck: { reason: 'paused', since: minutesAgo(5) } })])
    await openActivity()

    const [row] = within(await screen.findByRole('region', { name: /^Queued/ })).getAllByRole('listitem')

    expect(row).toHaveTextContent('Stuck: paused in the download client')
  })
})

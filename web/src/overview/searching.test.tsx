import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type SearchStatus = components['schemas']['SearchStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const status = (over: Partial<SearchStatus> = {}): SearchStatus => ({
  due: { versions: 0, episodes: 0, upgrades: 0 },
  pass: null,
  next_pass_at: null,
  last_pass: null,
  upgrades_per_pass: 5,
  indexers: [],
  ...over,
})

const indexer = (over: Partial<SearchStatus['indexers'][number]> = {}): SearchStatus['indexers'][number] => ({
  instance_id: 1,
  name: 'NZBgeek',
  search_used: 10,
  search_max: null,
  held: null,
  held_until: null,
  ...over,
})

function fakeStatus(s: SearchStatus) {
  server.use(http.get('/search/status', ({ response }) => response(200).json(s)))
}

async function card() {
  renderApp()
  const region = await screen.findByRole('region', { name: 'Searching' })
  await waitFor(() => expect(region.querySelector('[aria-busy]')).toBeNull()) // a Skeleton stands in until the status arrives
  return region
}

describe('the Searching card on the Overview', () => {
  it('shows what waits, how far the pass has got, the episodes and the Upgrade searches', async () => {
    fakeStatus(status({ due: { versions: 120, episodes: 340, upgrades: 8 }, pass: { started_at: new Date().toISOString(), done: 15, total: 40 } }))

    const c = await card()

    expect(c).toHaveTextContent('120 Wanted waiting · searching 15 of 40')
    expect(c).toHaveTextContent('340 Wanted episodes in the Series among them')
    expect(c).toHaveTextContent('8 Versions due an Upgrade search · 5 Upgrade searches per pass')
  })

  it('lays the summary out as terms and values', async () => {
    fakeStatus(status({ due: { versions: 120, episodes: 340, upgrades: 8 }, last_pass: { finished_at: new Date().toISOString(), searched: 40, grabbed: 3 } }))

    const c = await card()

    const term = await within(c).findByText('Last Pass')
    expect(term.closest('dl')).toHaveTextContent(/searched 40 Wanted Versions/)
    expect(within(c).getByText('Waiting').closest('dl')).toHaveTextContent('120 Wanted waiting')
  })

  it('says when the next pass starts and how the last one went', async () => {
    const finished = new Date(Date.now() - 2 * 60_000).toISOString()
    fakeStatus(status({ next_pass_at: new Date(Date.now() + 3 * 60_000).toISOString(), last_pass: { finished_at: finished, searched: 40, grabbed: 3 } }))

    const c = await card()

    expect(c).toHaveTextContent('Nothing waiting · next pass in 3 min')
    expect(c).toHaveTextContent(/Last pass at \d{1,2}:\d{2}.*searched 40 Wanted Versions and made 3 Grabs/)
  })

  it('names an indexer that holds the sweeps back, and until when', async () => {
    fakeStatus(
      status({
        due: { versions: 25, episodes: 0, upgrades: 0 },
        indexers: [
          indexer(),
          indexer({ instance_id: 2, name: 'Alpha', held: 'request_limit', held_until: new Date(Date.now() + 3_600_000).toISOString() }),
          indexer({ instance_id: 3, name: 'Beta', held: 'budget', search_used: 400, search_max: 500 }),
          indexer({ instance_id: 4, name: 'Gamma', held: 'backing_off', held_until: new Date(Date.now() + 60_000).toISOString() }),
        ],
      }),
    )

    const c = await card()

    expect(c).not.toHaveTextContent('NZBgeek')
    expect(c).toHaveTextContent(/Alpha paused until \d{1,2}:\d{2}.* \(request limit\)/)
    expect(c).toHaveTextContent('Beta out of budget for sweeps: 400 of 500 searches today')
    expect(c).toHaveTextContent(/Gamma backing off after errors until \d{1,2}:\d{2}/)
  })

  it("shows each indexer's searches left today when its limit is known", async () => {
    fakeStatus(
      status({
        indexers: [
          indexer({ search_used: 30, search_max: 500 }),
          indexer({ instance_id: 2, name: 'Alpha', search_used: 100, search_max: 100, held: 'request_limit', held_until: new Date(Date.now() + 3_600_000).toISOString() }),
          indexer({ instance_id: 3, name: 'Unknown' }),
        ],
      }),
    )

    const c = await card()

    expect(c).toHaveTextContent('NZBgeek: 470 of 500 searches left today')
    expect(c).toHaveTextContent(/Alpha paused until \d{1,2}:\d{2}.* \(request limit\) · 0 of 100 searches left today/)
    expect(c).not.toHaveTextContent('Unknown')
  })
})

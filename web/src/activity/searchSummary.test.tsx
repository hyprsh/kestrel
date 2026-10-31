import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { components } from '../api/schema.gen'
import { SearchSummary } from './SearchSummary'

type SearchStatus = components['schemas']['SearchStatus']

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

/** The summary of `s`, in a region of its own. */
function card(s: SearchStatus) {
  render(
    <section aria-label="Searching">
      <SearchSummary status={s} />
    </section>,
  )
  return screen.getByRole('region', { name: 'Searching' })
}

describe('the search summary in the Searching stage of Activity', () => {
  it('shows what waits, how far the pass has got, the episodes and the Upgrade searches', () => {
    const c = card(status({ due: { versions: 120, episodes: 340, upgrades: 8 }, pass: { started_at: new Date().toISOString(), done: 15, total: 40 } }))

    expect(c).toHaveTextContent('120 Wanted waiting · searching 15 of 40')
    expect(c).toHaveTextContent('340 Wanted episodes in the Series among them')
    expect(c).toHaveTextContent('8 Versions due an Upgrade search · 5 Upgrade searches per pass')
  })

  it('lays the summary out as terms and values', () => {
    const c = card(status({ due: { versions: 120, episodes: 340, upgrades: 8 }, last_pass: { finished_at: new Date().toISOString(), searched: 40, grabbed: 3 } }))

    const term = within(c).getByText('Last Pass')
    expect(term.closest('dl')).toHaveTextContent(/searched 40 Wanted Versions/)
    expect(within(c).getByText('Waiting').closest('dl')).toHaveTextContent('120 Wanted waiting')
  })

  it('says when the next pass starts and how the last one went', () => {
    const finished = new Date(Date.now() - 2 * 60_000).toISOString()
    const c = card(status({ next_pass_at: new Date(Date.now() + 3 * 60_000).toISOString(), last_pass: { finished_at: finished, searched: 40, grabbed: 3 } }))

    expect(c).toHaveTextContent('Nothing waiting · next pass in 3 min')
    expect(c).toHaveTextContent(/Last pass at \d{1,2}:\d{2}.*searched 40 Wanted Versions and made 3 Grabs/)
  })

  it('names an indexer that holds the sweeps back, and until when', () => {
    const c = card(
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

    expect(c).not.toHaveTextContent('NZBgeek')
    expect(c).toHaveTextContent(/Alpha paused until \d{1,2}:\d{2}.* \(request limit\)/)
    expect(c).toHaveTextContent('Beta out of budget for sweeps: 400 of 500 searches today')
    expect(c).toHaveTextContent(/Gamma backing off after errors until \d{1,2}:\d{2}/)
  })

  it("shows each indexer's searches left today when its limit is known", () => {
    const c = card(
      status({
        indexers: [
          indexer({ search_used: 30, search_max: 500 }),
          indexer({ instance_id: 2, name: 'Alpha', search_used: 100, search_max: 100, held: 'request_limit', held_until: new Date(Date.now() + 3_600_000).toISOString() }),
          indexer({ instance_id: 3, name: 'Unknown' }),
        ],
      }),
    )

    expect(c).toHaveTextContent('NZBgeek: 470 of 500 searches left today')
    expect(c).toHaveTextContent(/Alpha paused until \d{1,2}:\d{2}.* \(request limit\) · 0 of 100 searches left today/)
    expect(c).not.toHaveTextContent('Unknown')
  })
})

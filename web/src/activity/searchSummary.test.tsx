import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { components } from '../api/schema.gen'
import { lastPassOf, passOf } from '../test/search'
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
  gap_ms: 2000,
  gap_widened: false,
  waiting_until: null,
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
  it('shows what waits, the pass, the episodes and the Upgrade searches', () => {
    const c = card(status({ due: { versions: 120, episodes: 340, upgrades: 8 }, pass: passOf({ done: 15, total: 40 }) }))

    expect(c).toHaveTextContent('120 Wanted waiting')
    expect(c).toHaveTextContent('15 of 40 Wanted')
    expect(c).toHaveTextContent('340 Wanted episodes in the Series among them')
    expect(c).toHaveTextContent('8 Versions due an Upgrade search · 5 Upgrade searches per pass')
  })

  it('lays the episodes and Upgrades out as terms and values', () => {
    const c = card(status({ due: { versions: 120, episodes: 340, upgrades: 8 } }))

    expect(within(c).getByText('Episodes').closest('dl')).toHaveTextContent('340 Wanted episodes')
    expect(within(c).getByText('Upgrades').closest('dl')).toHaveTextContent('8 Versions due an Upgrade search')
  })

  it('says when the next pass starts and how the last one went', () => {
    const finished = new Date(Date.now() - 2 * 60_000).toISOString()
    const c = card(
      status({
        next_pass_at: new Date(Date.now() + 3 * 60_000).toISOString(),
        last_pass: lastPassOf({ finished_at: finished, searched: 40, grabbed: 3, releases_seen: 418, duration_ms: 3 * 60_000 }),
      }),
    )

    expect(c).toHaveTextContent('Nothing waiting · next pass in 3 min')
    expect(c).toHaveTextContent(/Last pass \d{1,2}:\d{2}.*: 40 searched · 418 releases checked · 3 Grabs · took 3 min/)
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

  it("says when slow answers have widened an indexer's gap", () => {
    const c = card(status({ indexers: [indexer({ gap_ms: 8000, gap_widened: true }), indexer({ instance_id: 2, name: 'Alpha', gap_ms: 2000 })] }))

    expect(c).toHaveTextContent('NZBgeek slow to answer, 8 s between searches')
    expect(c).not.toHaveTextContent('Alpha')
  })

  it('says which indexer a running search is waiting for, and how long', () => {
    const c = card(
      status({
        pass: passOf({ done: 3, total: 12 }),
        indexers: [indexer({ waiting_until: new Date(Date.now() + 4_200).toISOString() }), indexer({ instance_id: 2, name: 'Alpha', waiting_until: new Date(Date.now() - 1_000).toISOString() })],
      }),
    )

    expect(c).toHaveTextContent('Waiting for NZBgeek, 4 s')
    expect(c).not.toHaveTextContent('Waiting for Alpha')
  })

  it('shows no waiting line while no request waits', () => {
    const c = card(status({ pass: passOf({ done: 3, total: 12 }), indexers: [indexer()] }))

    expect(c).not.toHaveTextContent('Waiting for')
  })
})

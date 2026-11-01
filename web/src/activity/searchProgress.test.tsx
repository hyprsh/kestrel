import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema.gen'
import { lastPassOf, passOf } from '../test/search'
import { SearchProgress } from './SearchProgress'

type SearchStatus = components['schemas']['SearchStatus']

const status = (over: Partial<SearchStatus> = {}): SearchStatus => ({
  due: { versions: 9, episodes: 0, upgrades: 0 },
  pass: null,
  next_pass_at: null,
  last_pass: null,
  upgrades_per_pass: 5,
  indexers: [],
  ...over,
})

const current = { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: 'Standard', season: 5, episodes: ['S05E01', 'S05E02'], releases_seen: 12 }

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

describe('the search progress row', () => {
  it('shows what is searched now, the bar, the counts, the time left and the Releases checked', async () => {
    const open = vi.fn()
    render(<SearchProgress status={status({ pass: passOf({ started_at: ago(4), done: 4, total: 12, current, releases_seen: 418, grabbed: 1 }) })} onOpenTitle={open} />)

    const row = screen.getByLabelText('Search pass')
    expect(row).toHaveTextContent('Searching Wanted')
    expect(row).toHaveTextContent('Now: Breaking Bad · S05 · Standard · 12 releases')
    expect(within(row).getByRole('progressbar', { name: 'Search progress' })).toBeInTheDocument()
    expect(row).toHaveTextContent('4 of 12 Wanted · about 8 min left')
    expect(row).toHaveTextContent('418 releases checked · 1 Grab so far')
    await userEvent.click(within(row).getByRole('button', { name: /Breaking Bad/ }))
    expect(open).toHaveBeenCalledWith(7)
  })

  it('hides the time left until two items are done', () => {
    render(<SearchProgress status={status({ pass: passOf({ started_at: ago(1), done: 1, total: 12, current }) })} />)

    expect(screen.getByLabelText('Search pass')).toHaveTextContent('1 of 12 Wanted')
    expect(screen.getByLabelText('Search pass')).not.toHaveTextContent('left')
  })

  it('leaves the count off the Now line until a Release is checked', () => {
    render(<SearchProgress status={status({ pass: passOf({ current: { ...current, releases_seen: 0 } }) })} />)

    expect(screen.getByLabelText('Search pass')).not.toHaveTextContent('Standard · 0 release')
  })

  it('leaves the count off the Now line until a Release is checked', () => {
    render(<SearchProgress status={status({ pass: passOf({ current: { ...current, releases_seen: 0 } }) })} />)

    expect(screen.getByLabelText('Search pass')).not.toHaveTextContent('Standard · 0 release')
  })

  it('has no Now line between items', () => {
    render(<SearchProgress status={status({ pass: passOf({ done: 3, total: 12, current: null }) })} />)

    expect(screen.getByLabelText('Search pass')).not.toHaveTextContent('Now:')
  })

  it('counts the Upgrade searches once the Wanted ones are done', () => {
    render(<SearchProgress status={status({ pass: passOf({ started_at: ago(6), done: 12, total: 12, upgrades_done: 2, upgrades_total: 5 }) })} />)

    const row = screen.getByLabelText('Search pass')
    expect(row).toHaveTextContent('Searching Upgrades')
    expect(row).toHaveTextContent('2 of 5 Upgrades · about')
  })

  it('names the episodes when a search covers several seasons', () => {
    render(<SearchProgress status={status({ pass: passOf({ current: { ...current, season: null, episodes: ['S01E01', 'S02E03'] } }) })} />)

    expect(screen.getByLabelText('Search pass')).toHaveTextContent('Now: Breaking Bad · S01E01, S02E03 · Standard')
  })
})

describe('the search lines between passes', () => {
  it('says what waits, when the next pass starts and how the last one went', () => {
    render(<SearchProgress status={status({ due: { versions: 12, episodes: 0, upgrades: 0 }, next_pass_at: new Date(Date.now() + 5 * 60_000).toISOString(), last_pass: lastPassOf() })} />)

    expect(screen.queryByLabelText('Search pass')).not.toBeInTheDocument()
    expect(screen.getByText('12 Wanted waiting · next pass in 5 min')).toBeInTheDocument()
    expect(screen.getByText(/^Last pass \d{1,2}:\d{2}.*: 12 searched · 418 releases checked · 2 Grabs · took 3 min$/)).toBeInTheDocument()
  })

  it('adds the Upgrade searches a pass made', () => {
    render(<SearchProgress status={status({ last_pass: lastPassOf({ upgrades: 3 }) })} />)

    expect(screen.getByText(/12 searched · 3 Upgrade searches · 418 releases checked/)).toBeInTheDocument()
  })

  it('shows no last pass before the first', () => {
    render(<SearchProgress status={status({ due: { versions: 0, episodes: 0, upgrades: 0 } })} />)

    expect(screen.getByText('Nothing waiting')).toBeInTheDocument()
    expect(screen.queryByText(/Last pass/)).not.toBeInTheDocument()
  })
})

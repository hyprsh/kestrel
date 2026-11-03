import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlaceOpener, placeOf } from '../place'
import { Overview } from './Overview'
import { fakeStats } from '../test/stats'
import { emptyStats } from '../test/statsData'

const renderOverview = (open: (path: string) => void = () => {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlaceOpener.Provider value={open}>
        <Overview />
      </PlaceOpener.Provider>
    </QueryClientProvider>,
  )

/** Clicks the named button inside `scope` and returns the screen and filter text it opened. */
async function opens(scope: HTMLElement, name: string, open: ReturnType<typeof vi.fn>) {
  await userEvent.click(within(scope).getByRole('button', { name }))
  const place = placeOf(open.mock.lastCall![0])
  return `${place.screen}?${place.q}`
}

describe('the figures and cards that open the data behind them', () => {
  it('opens the Library from the Library, Wanted and Long Missing figures', async () => {
    const open = vi.fn()
    fakeStats()
    renderOverview(open)

    expect(await opens(await screen.findByRole('group', { name: 'Library' }), 'Open the Library', open)).toBe('library?')
    const wanted = screen.getByRole('group', { name: 'Wanted' })
    expect(await opens(wanted, 'Open Wanted in the Library', open)).toBe('library?is:wanted')
    expect(await opens(wanted, 'Open Long Missing in the Library', open)).toBe('library?is:long_missing sort:wanted_since')
  })

  it('opens Activity from the Grabs figure and its failed count over the range of the Overview', async () => {
    const open = vi.fn()
    fakeStats()
    renderOverview(open)

    const tile = await screen.findByRole('group', { name: 'Grabs · 30 d' })
    expect(await opens(tile, 'Open these Grabs in Activity', open)).toBe('activity?from:2026-10-02 to:2026-10-31')
    expect(await opens(tile, 'Open the failed Grabs in Activity', open)).toBe('activity?stage:failed from:2026-10-02 to:2026-10-31')
  })

  it('leaves the Grabs figure alone when nothing finished', async () => {
    fakeStats(() => emptyStats('30d'))
    renderOverview()

    const tile = await screen.findByRole('group', { name: 'Grabs · 30 d' })
    expect(within(tile).queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens the Library on a Slot from Library quality', async () => {
    const open = vi.fn()
    fakeStats()
    renderOverview(open)

    expect(await opens(await screen.findByRole('region', { name: 'Library quality' }), 'Open 4K in the Library', open)).toBe('library?slot:4k')
  })

  it('opens Requests from the Requests figures and each requester', async () => {
    const open = vi.fn()
    fakeStats()
    renderOverview(open)

    const card = await screen.findByRole('region', { name: 'Requests' })
    expect(await opens(card, 'Open every Request', open)).toBe('requests?')
    expect(await opens(card, 'Open the open Requests', open)).toBe('requests?status:open')
    expect(await opens(card, "Open Ellie's Requests", open)).toBe('requests?requester:Ellie')
  })
})

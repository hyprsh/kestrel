import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { TitleRows } from './TitleRows'
import type { TitleRow } from '../api/queries'

const row = (id: number): TitleRow =>
  ({
    id,
    title: `Title ${id}`,
    kind: 'movie',
    year: 2000,
    has_poster: false,
    monitored: true,
    size: 0,
    slot_states: [],
    slots: {},
    wanted_episodes: { wanted: 0, long_missing: 0, seasons: [] },
  }) as unknown as TitleRow

const rows = Array.from({ length: 3000 }, (_, i) => row(i + 1))
const props = { loading: false, grabs: new Map(), now: Date.now(), selection: { count: 0 } as never, ticks: false, phone: false, onPick: () => {} }

// jsdom has no layout: every element is 100 px tall and the scroller 600 px, which a browser would measure.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.getAttribute('role') === 'listbox' || this.tagName === 'UL' ? 0 : this.hasAttribute('data-index') ? 100 : 600
    return { width: 400, height, top: 0, left: 0, right: 400, bottom: height, x: 0, y: 0, toJSON: () => ({}) }
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 100 : 600
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
})
afterEach(() => vi.restoreAllMocks())

describe('the Library list of thousands of Titles', () => {
  it('draws only the rows in view and a few around them, with the rest as margin', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TitleRows {...props} rows={rows} index={0} listRef={createRef<HTMLDivElement>()} />
      </QueryClientProvider>,
    )
    const drawn = screen.getAllByRole('option')
    expect(drawn.length).toBeGreaterThan(5)
    expect(drawn.length).toBeLessThan(40)
    expect(drawn[0]).toHaveAttribute('id', 'title-1')
    expect(drawn[drawn.length - 1].style.marginBottom).not.toBe('')
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// The scroller measures 600 px once it is in the page, as in a browser.
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

// Opening the Library from another screen mounts it with the Titles already cached, so the first commit has every row to
// draw while the scroller has not been measured yet. Rows created are counted, so a first commit that draws them all
// fails even when the next one drops them: that was about 52,000 elements for 1,000 Titles.
describe('the first commit of the Library list', () => {
  it('draws a screenful of rows, not every Title, before the scroller is measured', () => {
    // Every row element React ever creates, also one a later commit takes out again.
    const create = Document.prototype.createElement
    let added = 0
    vi.spyOn(Document.prototype, 'createElement').mockImplementation(function (this: Document, ...args: Parameters<Document['createElement']>) {
      const el = create.apply(this, args)
      if (args[0] === 'li') added++
      return el
    } as typeof Document.prototype.createElement)
    const rows = Array.from({ length: 3000 }, (_, i) => row(i + 1))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TitleRows
          rows={rows}
          index={0}
          loading={false}
          grabs={new Map()}
          now={Date.now()}
          selection={{ count: 0 } as never}
          ticks={false}
          phone={false}
          onPick={() => {}}
          listRef={createRef<HTMLDivElement>()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getAllByRole('option').length).toBeLessThan(60)
    expect(added).toBeGreaterThan(0)
    expect(added).toBeLessThan(60)
  })
})

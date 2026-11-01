import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeSeries } from '../test/series'

async function openSeries() {
  fakeSeries()
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('grid', { name: 'Episodes' })
}

const heads = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('columnheader')
    .map((h) => h.textContent)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the episode table columns', () => {
  it('moves a column by dragging its head, heads and cells together, and remembers it', async () => {
    const grid = await openSeries()
    expect(heads(grid).slice(1, 5)).toEqual(['Name', 'Aired', 'Standard', '4K'])

    const from = within(grid)
      .getAllByRole('columnheader')
      .find((h) => h.textContent === '4K')!
    const onto = within(grid)
      .getAllByRole('columnheader')
      .find((h) => h.textContent === 'Aired')!
    const elementFromPoint = document.elementFromPoint
    document.elementFromPoint = () => onto
    try {
      fireEvent.pointerDown(from, { button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 })
      fireEvent.pointerUp(window)
    } finally {
      document.elementFromPoint = elementFromPoint
    }

    expect(heads(grid).slice(1, 5)).toEqual(['Name', '4K', 'Aired', 'Standard'])
    const row = within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')!
    const buttons = within(row)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-cell'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([expect.stringContaining('4K'), expect.stringContaining('Standard')])
    expect(JSON.parse(localStorage.getItem('kestrel.columns.episodes.order')!)).toEqual(['4k', 'aired', 'standard'])
  })

  it('starts from a stored order and ignores a corrupt one', async () => {
    localStorage.setItem('kestrel.columns.episodes.order', JSON.stringify(['4k', 'aired']))
    expect(heads(await openSeries()).slice(1, 5)).toEqual(['Name', '4K', 'Aired', 'Standard'])
  })

  it('offers Reset columns while the order differs and restores order and widths', async () => {
    localStorage.setItem('kestrel.columns.episodes.order', JSON.stringify(['standard', '4k', 'aired']))
    localStorage.setItem('kestrel.columns.episodes', JSON.stringify({ name: 300 }))
    const grid = await openSeries()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset columns' }))
    expect(heads(grid).slice(1, 5)).toEqual(['Name', 'Aired', 'Standard', '4K'])
    expect(localStorage.getItem('kestrel.columns.episodes.order')).toBeNull()
    expect(localStorage.getItem('kestrel.columns.episodes')).toBeNull()
  })

  it('pins the tick box and Name, and gives the Name and each Slot a resize handle', async () => {
    const grid = await openSeries()
    expect(within(grid).getAllByRole('separator')).toHaveLength(3)
  })
})

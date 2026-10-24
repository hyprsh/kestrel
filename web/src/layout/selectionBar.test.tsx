import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Selection } from '../selection'
import { SelectionBar } from './SelectionBar'

const selection = (over: Partial<Selection> = {}): Selection => ({
  checked: [1, 2],
  count: 2,
  all: false,
  narrowed: false,
  has: () => true,
  toggle: vi.fn(),
  checkAll: vi.fn(),
  checkMatching: vi.fn(),
  clear: vi.fn(),
  active: true,
  setActive: vi.fn(),
  ...over,
})

describe('SelectionBar', () => {
  it('counts the ticked rows, offers Tick all and Clear, and shows the actions', async () => {
    const s = selection()
    render(
      <SelectionBar selection={s} shown={5} total={9}>
        <button>Search now</button>
      </SelectionBar>,
    )
    expect(screen.getByRole('group', { name: 'Selection' })).toHaveTextContent('2 ticked')
    await userEvent.click(screen.getByRole('button', { name: 'Tick all 5 shown' }))
    expect(s.checkAll).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Tick all 9 in this filter' }))
    expect(s.checkMatching).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: /^Clear/ }))
    expect(s.clear).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Search now' })).toBeInTheDocument()
  })

  it('words the controls as selected for verb="select" and shows before anything is ticked with always', () => {
    render(<SelectionBar selection={selection({ active: false, count: 0, checked: [] })} shown={3} verb="select" always />)
    expect(screen.getByRole('button', { name: 'Select all 3 shown' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Clear/ })).not.toBeInTheDocument()
  })

  it('renders nothing with no selection', () => {
    render(<SelectionBar selection={selection({ active: false })} shown={3} />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})

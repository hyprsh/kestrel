import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Menu, MenuItem, placeMenu } from './menu'
import { useSelection } from './selection'

function Harness({ onSearch = () => {} }: { onSearch?: () => void }) {
  const selection = useSelection([1, 2])
  const [outside, setOutside] = useState(0)
  return (
    <div>
      <button onClick={() => selection.toggle(1)}>Tick one</button>
      <span>{selection.count} ticked</span>
      <button onClick={() => setOutside(outside + 1)}>Elsewhere {outside}</button>
      <Menu label="Actions for Pilot" trigger="…">
        <MenuItem onSelect={onSearch}>Search</MenuItem>
        <MenuItem disabled onSelect={() => {}}>
          Delete files
        </MenuItem>
        <MenuItem onSelect={() => {}}>Manual search</MenuItem>
      </Menu>
    </div>
  )
}

describe('Menu', () => {
  it('opens from its button with focus on the first item and runs an item, then closes', async () => {
    const onSearch = vi.fn()
    render(<Harness onSearch={onSearch} />)
    const button = screen.getByRole('button', { name: 'Actions for Pilot' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)

    const menu = screen.getByRole('menu', { name: 'Actions for Pilot' })
    expect(menu).toBeVisible()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Search' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSearch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves with the arrow keys and refuses a disabled item', async () => {
    const onSearch = vi.fn()
    render(<Harness onSearch={onSearch} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Pilot' }))

    await userEvent.keyboard('{ArrowDown}')
    const del = screen.getByRole('menuitem', { name: 'Delete files' })
    expect(del).toHaveFocus()
    expect(del).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Search' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Manual search' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Search' })).toHaveFocus()
  })

  it('closes on Escape without clearing a selection and gives focus back', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Tick one' }))
    expect(screen.getByText('1 ticked')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Actions for Pilot' })
    await userEvent.click(button)

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByText('1 ticked')).toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('closes on a click outside it', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Pilot' }))

    await userEvent.click(screen.getByRole('button', { name: /elsewhere/i }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elsewhere 1' })).toBeInTheDocument()
  })
})

describe('placeMenu', () => {
  const viewport = 800

  it('opens below its button when there is room', () => {
    expect(placeMenu({ top: 100, bottom: 120 }, 150, viewport)).toEqual({ up: false, maxHeight: null })
  })

  it('opens upward when the button is too near the bottom for it', () => {
    expect(placeMenu({ top: 700, bottom: 720 }, 150, viewport)).toEqual({ up: true, maxHeight: null })
  })

  it('takes the roomier side and scrolls when it fits on neither', () => {
    expect(placeMenu({ top: 300, bottom: 320 }, 500, viewport)).toEqual({ up: false, maxHeight: 800 - 320 - 12 })
    expect(placeMenu({ top: 500, bottom: 520 }, 600, viewport)).toEqual({ up: true, maxHeight: 500 - 12 })
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VersionActions } from './VersionActions'

describe("an opened Version's actions", () => {
  it('puts the next action in a block of its own, over a row of the others, each under its whole name', () => {
    const { container } = render(<VersionActions primary={<button>Search Wanted</button>} secondary={<button>Manual Search</button>} more={<button>More…</button>} />)
    const row = container.querySelector('[data-version-actions]')!
    const [first, second] = Array.from(row.children)
    // The next action alone, then Manual Search and More together beneath it (a phone stacks them; a wide screen lays them in one row).
    expect(first).toContainElement(screen.getByRole('button', { name: 'Search Wanted' }))
    expect(first).not.toContainElement(screen.getByRole('button', { name: 'Manual Search' }))
    expect(second).toContainElement(screen.getByRole('button', { name: 'Manual Search' }))
    expect(second).toContainElement(screen.getByRole('button', { name: 'More…' }))
  })

  it('has a row of the others alone when a Version has no next action', () => {
    const { container } = render(<VersionActions secondary={<button>Manual Search</button>} more={<button>More…</button>} />)
    expect(container.querySelector('[data-version-actions]')!.children).toHaveLength(1)
  })
})

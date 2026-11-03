import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FitLine } from './FitLine'

/** jsdom lays nothing out: give every element the widths a test names. */
function widths(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scroll })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client })
}

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
})

describe('a line that shortens to fit', () => {
  it('shows the full text when it fits', () => {
    widths(100, 200)
    render(<FitLine text="Long Missing · Wanted for 100 days" short="Long Missing · 100 d" />)
    expect(screen.getByText('Long Missing · Wanted for 100 days')).toBeInTheDocument()
  })

  it('shows the short form when the full text overflows, and the full text as its tooltip', () => {
    widths(300, 200)
    render(<FitLine text="Long Missing · Wanted for 100 days" short="Long Missing · 100 d" />)
    expect(screen.getByText('Long Missing · 100 d')).toHaveAttribute('title', 'Long Missing · Wanted for 100 days')
  })

  it('has nothing to shorten without a short form', () => {
    widths(300, 200)
    render(<FitLine text="Standard & 4K · 3.0 GB" />)
    expect(screen.getByText('Standard & 4K · 3.0 GB')).not.toHaveAttribute('title')
  })
})

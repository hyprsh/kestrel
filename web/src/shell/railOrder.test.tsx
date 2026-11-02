import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../App'

describe('the desktop rail', () => {
  it('keeps the screens in the top group and ends the bottom group with Settings', async () => {
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await screen.findByRole('button', { name: /^Health/ })
    const rail = screen.getByRole('navigation')
    const names = within(rail)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
    const at = (re: RegExp) => names.findIndex((n) => re.test(n))
    expect(at(/^Settings$/)).toBe(names.length - 1)
    expect(at(/^Log$/)).toBeLessThan(at(/^Health/))
    expect(at(/^Health/)).toBeLessThan(at(/^Settings$/))
    expect(at(/theme/i)).toBeLessThan(at(/^Settings$/))
  })
})

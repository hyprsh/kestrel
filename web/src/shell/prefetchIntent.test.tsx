import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'

const loaded = vi.hoisted(() => ({ log: 0 }))
vi.mock('../log/Log', async (importOriginal) => {
  loaded.log++
  return importOriginal()
})

describe('fetching a screen ahead of the click', () => {
  it("fetches a screen's chunk when its rail item is pointed at, before it is clicked", async () => {
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    const log = await screen.findByRole('button', { name: 'Log' })
    expect(loaded.log).toBe(0)

    await userEvent.hover(log)

    await vi.waitFor(() => expect(loaded.log).toBe(1))
    expect(screen.queryByRole('heading', { level: 1, name: 'Log' })).not.toBeInTheDocument()
  })
})

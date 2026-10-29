// Settings at a phone's width: a list of sections, each opening full screen with a Back button.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  history.replaceState(null, '', '/')
})
afterEach(() => vi.unstubAllGlobals())

const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'More' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
}

describe('Settings on a phone', () => {
  it('lists the sections, opens one full screen as /settings/<section> and Back returns to the list', async () => {
    const user = userEvent.setup()
    renderApp()
    await openSettings(user)

    const list = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(list).getAllByRole('button')).toHaveLength(17)
    expect(screen.queryByRole('heading', { name: 'Indexers' })).not.toBeInTheDocument() // the list, not the page of sections
    expect(location.pathname).toBe('/settings')

    await user.click(within(list).getByRole('button', { name: 'Indexers' }))
    expect(await screen.findByRole('heading', { name: 'Indexers' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Root folders' })).not.toBeInTheDocument()
    expect(location.pathname).toBe('/settings/indexers')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument())
    expect(location.pathname).toBe('/settings')
  })

  it('goes back to the list with the browser Back', async () => {
    const user = userEvent.setup()
    history.replaceState(null, '', '/settings')
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Grabs' }))
    expect(await screen.findByRole('heading', { name: 'Grabs' })).toBeInTheDocument()
    history.back()
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument())
  })

  it('opens a section from its address, and Back from there shows the list', async () => {
    const user = userEvent.setup()
    history.replaceState(null, '', '/settings/root-folders')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Root folders' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Indexers' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })

  it('shows the list again when Settings is chosen again from a section', async () => {
    const user = userEvent.setup()
    history.replaceState(null, '', '/settings/grabs')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Grabs' })).toBeInTheDocument()
    await openSettings(user)
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })
})

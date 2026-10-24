// The SPA at a phone's width (below 640px): matchMedia answers for the phone breakpoint, as in responsive.ts.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 639'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

const rows = () => [row(1, 'Paddington', 'Paddington'), row(2, 'Heat', 'Heat', { year: 1995 })]

describe('the shell on a phone', () => {
  it('replaces the icon rail with a bottom tab bar of Overview, Library, Upcoming, Activity and More', async () => {
    renderApp()
    const tabs = await screen.findByRole('navigation', { name: 'Screens' })
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Overview', 'Library', 'Upcoming', 'Activity', 'More', ''])
    expect(within(tabs).getByRole('button', { name: 'Search or run a command' })).toBeInTheDocument() // the accessory
    expect(within(tabs).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Kestrel, go to Overview' })).not.toBeInTheDocument() // the rail is gone

    await userEvent.click(within(tabs).getByRole('button', { name: 'Upcoming' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Upcoming')
    expect(within(tabs).getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens More with Settings, Log, About, the theme switch, the version and its status dot', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    for (const name of ['Settings', 'Log', 'About']) expect(within(sheet).getByRole('button', { name })).toBeInTheDocument()
    expect(within(sheet).getByRole('radio', { name: /dark/i })).toBeInTheDocument()
    expect(await within(sheet).findByText(/Kestrel \d/)).toBeInTheDocument()

    // Each row is a full-width button named by its screen, in order, ahead of Log out.
    ;['Settings', 'Log', 'Requests'].forEach((name, i) => expect(within(sheet).getAllByRole('button')[i]).toHaveAccessibleName(name))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Log')
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Screens' })).getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page')
  })

  it('has a search button that opens the command menu, with no keyboard shortcut needed', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Search or run a command' }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
  })

  it('has an Add Title button that opens the menu in Add mode', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Add Title' }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
  })
})

describe('the Library on a phone', () => {
  const openLibrary = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    return screen.findByRole('listbox', { name: /library/i })
  }

  it('shows the list full width, then a tapped Title full screen, and Back returns to the list', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    expect(screen.queryByRole('region', { name: 'Paddington' })).not.toBeInTheDocument() // no side-by-side pane

    await userEvent.click(await within(list).findByRole('option', { name: /heat/i }))
    expect(await screen.findByRole('heading', { name: 'Heat' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /library/i })).not.toBeInTheDocument()
    expect(location.pathname).toBe('/library/2')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('listbox', { name: /library/i })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Heat' })).not.toBeInTheDocument()
    expect(location.pathname).toBe('/library')
  })

  it('goes back to the list with the browser Back', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await userEvent.click(await within(list).findByRole('option', { name: /paddington/i }))
    expect(await screen.findByRole('heading', { name: 'Paddington' })).toBeInTheDocument()

    history.back()
    await waitFor(() => expect(screen.getByRole('listbox', { name: /library/i })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Paddington' })).not.toBeInTheDocument()
  })

  it('opens a Title from its address', async () => {
    fakeLibrary(rows())
    history.replaceState(null, '', '/library/2')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Heat' })).toBeInTheDocument()
  })

  it('keeps the filters in a row that opens', async () => {
    fakeLibrary(rows())
    await openLibrary()
    expect(screen.queryByRole('combobox', { name: 'Filter the Library' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter the Library' }), 'heat')
    expect(within(screen.getByRole('listbox', { name: /library/i })).getAllByRole('option')).toHaveLength(1)
  })

  it('shows the query in the Filter title while the filters are closed, and opens and closes them', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const filterButton = screen.getByRole('button', { name: 'Filter' })
    expect(filterButton).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(filterButton)
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter the Library' }), 'heat')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const closed = screen.getByRole('button', { name: 'Filter: heat' })
    expect(closed).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: 'Filter the Library' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adopt existing library' })).not.toBeInTheDocument()
    await userEvent.click(closed)
    expect(screen.getByRole('combobox', { name: 'Filter the Library' })).toHaveValue('heat')
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'true')
  })
})

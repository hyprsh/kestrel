// The desktop shell: no top bar; the Library's SidePanel holds its name, filter, Filter, Sort and actions, the screens
// without a panel keep a heading line, and the rail's search button opens the command menu either way.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => history.replaceState(null, '', '/'))

describe('the desktop shell without a top bar', () => {
  it('has a heading line and no command box on the Overview, and Health in the rail only', async () => {
    renderApp()
    const bar = await screen.findByRole('banner')
    expect(bar).toHaveTextContent('Overview')
    expect(within(bar).queryByRole('button')).not.toBeInTheDocument()
    expect(await within(screen.getByRole('navigation')).findByRole('button', { name: /^Health/ })).toBeInTheDocument()
  })

  it("holds the Library's name, actions, filter, Filter and Sort in its side panel, and no heading line", async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const panel = await screen.findByRole('complementary', { name: 'Library' })
    expect(within(panel).getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(await within(panel).findByRole('combobox', { name: 'Filter the Library' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /^Filter/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /^Sort/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Library actions' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Add Title' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search or run a command' })).not.toBeInTheDocument()
  })

  it('shows an active filter as a chip that removes it, and counts it in Filter', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    history.replaceState(null, '', '/library?q=is%3Awanted')
    renderApp()
    const panel = await screen.findByRole('complementary', { name: 'Library' })
    expect(within(panel).getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove Wanted' }))
    expect(within(panel).queryByRole('button', { name: 'Remove Wanted' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: 'Filter the Library' })).toHaveValue('')
  })

  it('keeps `/` focusing the filter field in the side panel', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const field = await within(await screen.findByRole('complementary', { name: 'Library' })).findByRole('combobox', { name: 'Filter the Library' })
    await screen.findAllByRole('option')
    await userEvent.keyboard('/')
    expect(field).toHaveFocus()
  })

  it("holds Activity's filter field and Views in its side panel, and Upcoming has its own panel", async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    const panel = await screen.findByRole('complementary', { name: 'Activity' })
    expect(await within(panel).findByRole('combobox', { name: 'Filter Activity' })).toBeInTheDocument()
    expect(within(panel).getByRole('navigation', { name: 'Views' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upcoming' }))
    expect(await screen.findByRole('complementary', { name: 'Upcoming' })).toBeInTheDocument()
  })

  it('opens the command menu from the rail search button, on any screen', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /^Search or run a command \(/ }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Log' }))
    await userEvent.click(screen.getByRole('button', { name: /^Search or run a command \(/ }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
  })
})

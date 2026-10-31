// The desktop top bar: the command box on the screens that have none of their own, a screen's bar in its place on the four
// that do, and the rail's search button for the command menu either way.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => history.replaceState(null, '', '/'))

describe('the desktop top bar', () => {
  it('has the command box on the Overview', async () => {
    renderApp()
    const bar = await screen.findByRole('banner')
    expect(within(bar).getByRole('button', { name: 'Search or run a command' })).toBeInTheDocument()
    expect(within(bar).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it("holds the Library's filter, Filter and Display, and no command box, on the Library", async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const bar = screen.getByRole('banner')
    expect(await within(bar).findByRole('combobox', { name: 'Filter the Library' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^Filter/ })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Display' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Add Title' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search or run a command' })).not.toBeInTheDocument()
  })

  it('keeps `/` focusing the filter that sits in the top bar', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const field = await within(screen.getByRole('banner')).findByRole('combobox', { name: 'Filter the Library' })
    await screen.findAllByRole('option')
    await userEvent.keyboard('/')
    expect(field).toHaveFocus()
  })

  it("puts Activity's view switcher and Upcoming's Today in the top bar", async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    expect(await within(screen.getByRole('banner')).findByRole('button', { name: 'Activity: Grabs' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upcoming' }))
    expect(await within(screen.getByRole('banner')).findByRole('button', { name: 'Today' })).toBeInTheDocument()
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

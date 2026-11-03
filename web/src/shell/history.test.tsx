// Back and Forward between screens: another screen is a new history entry, a change within a screen replaces it.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeStats } from '../test/stats'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => history.replaceState(null, '', '/'))

describe('history between screens', () => {
  it('steps back and forward between two screens', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    await screen.findByRole('complementary', { name: 'Activity' })
    expect(location.pathname).toBe('/activity')

    history.back()
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' }, { timeout: 8000 })).toBeInTheDocument()
    expect(location.pathname).toBe('/')

    history.forward()
    expect(await screen.findByRole('complementary', { name: 'Activity' })).toBeInTheDocument()
    expect(location.pathname).toBe('/activity')
  })

  it('adds no history entry for each letter typed in a filter', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    const panel = await screen.findByRole('complementary', { name: 'Activity' })
    const before = history.length
    await userEvent.type(within(panel).getByRole('combobox'), 'heat')
    await waitFor(() => expect(location.search).toContain('q=heat'))
    expect(history.length).toBe(before)
  })

  it('returns from a drill-down to the Overview with the range it had', async () => {
    fakeStats()
    renderApp()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Range' }), 'Last 7 days')
    expect(location.search).toBe('?range=7d')

    const card = await screen.findByRole('region', { name: 'Grabs per day' })
    await userEvent.click(within(card).getAllByRole('button', { name: /Open in Activity$/ })[0])
    await screen.findByRole('complementary', { name: 'Activity' })
    expect(location.pathname).toBe('/activity')
    expect(location.search).not.toContain('range')

    history.back()
    expect(await screen.findByRole('combobox', { name: 'Range' })).toHaveValue('7d')
    expect(location.search).toBe('?range=7d')
  })

  it('opens the Overview at the range in its address', async () => {
    fakeStats()
    history.replaceState(null, '', '/?range=90d')
    renderApp()
    expect(await screen.findByRole('combobox', { name: 'Range' })).toHaveValue('90d')
  })
})

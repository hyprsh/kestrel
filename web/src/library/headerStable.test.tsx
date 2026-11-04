import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail } from '../test/library'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

// A season row says the same thing open or closed (#388): opening adds the episodes below it and changes nothing above.

/** Opens the Title named `name` from the Library: it is the pane beside the list on a wide screen, and a page of its own on a phone. */
async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  if (typeof window.matchMedia === 'function') await userEvent.click(await screen.findByRole('option', { name }))
}

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** The text of a season's row: it comes before the episodes, which show only while it is open. */
const header = (row: HTMLElement) => row.textContent ?? ''

/** Returns the row text of the season named `name` while it is closed and while it is open. */
async function closedAndOpen(scope: ReturnType<typeof within>, name: RegExp) {
  const button = scope.getByRole('button', { name })
  const row = button.closest('[role=row]') as HTMLElement
  if (button.getAttribute('aria-expanded') === 'true') await userEvent.click(button)
  const closed = header(row)
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  return { closed, open: header(row) }
}

function stableTests() {
  it('a Season', async () => {
    const state = fakeSeries()
    state.get().episodes = [episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 100) } }), episode(3, 1, 2, 'Cat', { cells: { standard: cell('wanted') } })]
    const r = seriesRow(5, 'Breaking Bad')
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { kind: 'series', series_monitor: 'all' }))))
    await openTitle(/breaking bad/i)
    const table = await screen.findByRole('table', { name: 'Seasons' })
    await within(table).findByRole('button', { name: /^Season 1:/ }, { timeout: 5000 })
    const s = await closedAndOpen(within(table), /^Season 1:/)
    expect(s.open).toBe(s.closed)
    expect(s.closed).toContain('Season 1')
  })
}

describe('a season row header open and closed', stableTests)

describe('a season row header open and closed, on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  stableTests()
})

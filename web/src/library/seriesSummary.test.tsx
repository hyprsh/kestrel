import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { cell, episode, fakeSeries } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { version: number; body: unknown }

/** Breaking Bad in the grid with its summary open: Season 1 has S01E01 (Standard filled, 4K Wanted), S01E02 (not out) and S01E03 (Wanted in both). */
async function openSummary() {
  const state = fakeSeries()
  state.get().episodes.push(episode(4, 1, 3, 'Gray Matter', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }))
  const searched: Posted[] = []
  const manual: Posted[] = []
  server.use(
    http.post('/versions/{id}/search', async ({ params, request, response }) => {
      searched.push({ version: Number(params.id), body: await request.json() })
      return response(202).empty()
    }),
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      manual.push({ version: Number(params.id), body: await request.json() })
      return response(200).json({ items: [], indexer_errors: [] })
    }),
  )
  localStorage.setItem('kestrel.library.view', 'grid')
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findByRole('listbox', { name: 'Library' })
  await userEvent.keyboard('{Enter}')
  const panel = await screen.findByRole('complementary', { name: 'Breaking Bad summary' })
  await within(panel).findByRole('list', { name: 'Seasons' })
  return { panel, searched, manual }
}

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe("a Series' summary in the grid", () => {
  it('has a row per season with its count, and Search N Wanted for the whole Series', async () => {
    const { panel, searched } = await openSummary()
    const seasons = within(within(panel).getByRole('list', { name: 'Seasons' }))
    expect(seasons.getAllByRole('button', { name: /episodes$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Season 1 episodes', 'Specials episodes'])

    await userEvent.click(within(panel).getByRole('button', { name: 'Search 2 Wanted' }))
    // Wanted: S01E01 and S01E03 in 4K, S01E03 in Standard.
    await waitFor(() => expect(searched).toHaveLength(2))
    expect(searched).toContainEqual({ version: 52, body: { episode_ids: [2, 4] } })
    expect(searched).toContainEqual({ version: 51, body: { episode_ids: [4] } })
  })

  it('searches a season from its Search N, and opens Manual search for it from Manual…', async () => {
    const { panel, searched, manual } = await openSummary()

    await userEvent.click(within(panel).getByRole('button', { name: 'Search Season 1' }))
    await waitFor(() => expect(searched).toHaveLength(2))
    expect(searched).toContainEqual({ version: 52, body: { season: 1 } })

    await userEvent.click(within(panel).getByRole('button', { name: 'Manual search Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Standard' }))
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1 } }]))
  })

  it('opens a season to its episodes, with Search and Manual… on the Wanted ones only', async () => {
    const { panel, searched } = await openSummary()
    expect(within(panel).queryByText('Gray Matter')).not.toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Season 1 episodes' }))

    const list = within(panel).getByRole('list', { name: 'Season 1 episodes' })
    expect(within(list).getByText('Gray Matter')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Search S01E02' })).not.toBeInTheDocument() // not out yet
    await userEvent.click(within(list).getByRole('button', { name: 'Search S01E03' }))
    await waitFor(() => expect(searched).toHaveLength(2))
    expect(within(list).getByRole('button', { name: 'Manual search S01E03' })).toBeInTheDocument()
  })

  it('finds an episode, opens its season and highlights it', async () => {
    const { panel } = await openSummary()
    await userEvent.type(within(panel).getByRole('searchbox', { name: 'Find an episode' }), 's1e3')

    const list = await within(panel).findByRole('list', { name: 'Season 1 episodes' })
    expect(within(list).getByText('Gray Matter').closest('li')).toHaveAttribute('aria-current', 'true')
  })
})

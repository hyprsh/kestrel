import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { version: number; body: unknown }

/** Breaking Bad (Standard 51, 4K 52): S01E01 Filled in Standard and Wanted in 4K, S01E02 not out yet. */
async function openLibrary() {
  const state = fakeSeries()
  const searched: Posted[] = []
  const manual: Posted[] = []
  const fetched: number[] = []
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
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findByRole('listbox', { name: /library/i })
  return { state, searched, manual, fetched }
}

const filter = () => screen.getByRole('combobox', { name: 'Filter the Library' })
const list = () => screen.getByRole('listbox', { name: 'Library' })
const hit = (name: RegExp) => within(list()).findByRole('option', { name })

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the Library filter with an episode code', () => {
  it('shows an Episode row and a Season row above the Title, with Search and Manual… on them', async () => {
    await openLibrary()
    await userEvent.type(filter(), 'breaking s1e1')

    const episode = await hit(/Breaking Bad S01E01/)
    expect(episode).toHaveTextContent('Pilot · Wanted in 4K')
    expect(within(episode).getByRole('button', { name: 'Search S01E01' })).toBeInTheDocument()
    expect(within(episode).getByRole('button', { name: 'Manual search S01E01' })).toBeInTheDocument()
    const season = await hit(/Breaking Bad Season 1/)
    expect(season).toHaveTextContent('0 of 2 · 1 Wanted')
    expect(within(season).getByRole('button', { name: 'Search Season 1' })).toHaveTextContent('Search 1')
    const options = within(list()).getAllByRole('option')
    expect(options.map((o) => o.id)).toEqual(['hit-episode-2', 'hit-season-5-1', 'title-5'])
  })

  it('reads 2x05 and S02E05 as well, and a season alone shows only a Season row', async () => {
    await openLibrary()
    await userEvent.type(filter(), 'breaking 1x02')
    expect(await hit(/Breaking Bad S01E02/)).toHaveTextContent('Not out yet')

    await userEvent.clear(filter())
    await userEvent.type(filter(), 'breaking s1')
    await hit(/Breaking Bad Season 1/)
    expect(within(list()).queryByRole('option', { name: /S01E0/ })).not.toBeInTheDocument()
  })

  it('matches nothing for a bare code', async () => {
    await openLibrary()
    await userEvent.type(filter(), 's1e1')
    await waitFor(() => expect(within(list()).queryAllByRole('option')).toHaveLength(0))
  })

  it('searches the episode from its Search button, and from the s key on the row under the cursor', async () => {
    const { searched } = await openLibrary()
    await userEvent.type(filter(), 'breaking s1e1')
    const episode = await hit(/Breaking Bad S01E01/)

    await userEvent.click(within(episode).getByRole('button', { name: 'Search S01E01' }))
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))

    await userEvent.click(list())
    await userEvent.keyboard('{Escape}')
    list().focus()
    await userEvent.keyboard('s')
    await waitFor(() => expect(searched).toHaveLength(2))
  })

  it('searches the Wanted episodes of the season from its Search N button', async () => {
    const { searched } = await openLibrary()
    await userEvent.type(filter(), 'breaking s1')
    const season = await hit(/Breaking Bad Season 1/)
    await userEvent.click(within(season).getByRole('button', { name: 'Search Season 1' }))
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1 } }]))
  })

  it('opens Manual search for the row under the cursor with m, in the Slot that is Wanted', async () => {
    const { manual } = await openLibrary()
    await userEvent.type(filter(), 'breaking s1e1')
    await hit(/Breaking Bad S01E01/)
    list().focus()

    await userEvent.keyboard('m')

    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
  })

  it('moves the cursor through the results and then the Titles with j and k', async () => {
    await openLibrary()
    await userEvent.type(filter(), 'breaking s1e1')
    await hit(/Breaking Bad S01E01/)
    list().focus()
    const on = () => within(list()).getByRole('option', { selected: true }).id

    expect(on()).toBe('hit-episode-2')
    await userEvent.keyboard('j')
    expect(on()).toBe('hit-season-5-1')
    await userEvent.keyboard('j')
    expect(on()).toBe('title-5')
    await userEvent.keyboard('k')
    expect(on()).toBe('hit-season-5-1')
  })

  it('opens the Title on that season with the episode highlighted on Enter, and keeps both in the address', async () => {
    await openLibrary()
    await userEvent.type(filter(), 'breaking s1e1')
    await hit(/Breaking Bad S01E01/)
    list().focus()

    await userEvent.keyboard('{Enter}')

    const grid = await screen.findByRole('grid', { name: 'Episodes' })
    await waitFor(() => expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')).toHaveAttribute('aria-current', 'true'))
    expect(screen.getByRole('tab', { name: /^Season 1/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(new URLSearchParams(location.search).get('episode')).toBe('1'))
  })

  it("fetches the episodes of the Series the name matches, not the whole Library's", async () => {
    const fetched: number[] = []
    const state = fakeSeries()
    state.lib.rows = [seriesRow(5, 'Breaking Bad'), seriesRow(6, 'Better Call Saul'), seriesRow(7, 'Fargo')]
    server.use(
      http.get('/titles/{id}/episodes', ({ params, response }) => {
        fetched.push(Number(params.id))
        return response(200).json({ items: state.get().episodes })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('listbox', { name: /library/i })
    fetched.length = 0
    await userEvent.type(filter(), 'saul s1e1')
    await hit(/Better Call Saul S01E01/)
    expect(fetched).toContain(6)
    expect(fetched).not.toContain(7) // matches neither the name nor the Title page
  })
})

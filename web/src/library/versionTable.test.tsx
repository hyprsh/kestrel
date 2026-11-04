// The Series table: Versions as the column heads, a menu for each Version × season or episode cell, and the phone's bottom sheet.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { releaseList } from '../test/grabs'
import { cell, episode, fakeSeries } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => vi.unstubAllGlobals())

const menuOf = (name: string) => screen.findByRole('menu', { name })

type Posted = { version: number; body: unknown }

/** Records Search Now calls. */
function recordSearches() {
  const sent: Posted[] = []
  server.use(
    http.post('/versions/{id}/search', async ({ params, request, response }) => {
      const text = await request.text()
      sent.push({ version: Number(params.id), body: text ? JSON.parse(text) : null })
      return response(202).json({ search_id: 'search-1' })
    }),
  )
  return sent
}

/** A Series with a season in which the Standard Version has everything and the 4K one is missing its second episode. */
function series() {
  const state = fakeSeries()
  state.get().episodes = [
    episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 100), '4k': cell('filled', 100) } }),
    episode(3, 1, 2, 'Cat', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
    episode(4, 1, 3, 'Gray', { cells: { standard: cell('downloading'), '4k': cell('wanted') } }),
  ]
  return state
}

async function openSeries() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await screen.findByRole('button', { name: /^Season 1:/ })
  return within(screen.getByRole('table', { name: 'Seasons' }))
}

describe('the Series table on a wide screen', () => {
  it('has a column head per Version, and no Add Version while every Slot has one', async () => {
    series()
    const table = await openSeries()
    expect(table.getAllByRole('columnheader').map((h) => h.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Standard', '4K']))
    expect(table.queryByRole('button', { name: 'Add Version' })).not.toBeInTheDocument()
    expect(table.getByText('1 season')).toBeInTheDocument()
    expect(table.getByText('3 episodes')).toBeInTheDocument()
  })

  it('lists the Version cards above the table, and names the Versions in its head and the dots in a legend', async () => {
    series()
    const table = await openSeries()
    const cards = within(screen.getByRole('list', { name: 'Versions' }))
    expect(cards.getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Standard', '4K'])
    expect(cards.queryByText('STD')).not.toBeInTheDocument()
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Standard', '4K']))
    const legend = within(screen.getByRole('list', { name: 'Legend' }))
    expect(legend.getAllByRole('listitem').map((i) => i.textContent)).toEqual(['Wanted', 'Downloading', 'Not out yet', 'Not monitored'])
  })

  it('shows a check for a Version that has the season and what is Wanted for one that does not, each with its own menu', async () => {
    series()
    const table = await openSeries()
    const season = table.getByRole('button', { name: /^Season 1:/ })
    expect(season).toBeInTheDocument()
    expect(table.getByRole('button', { name: 'Season 1, Standard: 1 downloading' })).toBeInTheDocument()
    await userEvent.click(table.getByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    const menu = await menuOf('Season 1, 4K: 2 Wanted')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([expect.stringContaining('Search Season 1 for 4K'), expect.stringContaining('Manual Search Season 1 (4K)…'), expect.stringContaining('Show the 2 Wanted Episodes')])
  })

  it('searches only that Version from a season cell’s menu', async () => {
    series()
    const sent = recordSearches()
    const table = await openSeries()
    await userEvent.click(table.getByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    await userEvent.click(within(await menuOf('Season 1, 4K: 2 Wanted')).getByRole('menuitem', { name: /Search Season 1 for 4K/ }))
    await waitFor(() => expect(sent).toEqual([{ version: 52, body: { season: 1 } }]))
  })

  it('filters the table to the Wanted episodes from “Show the Wanted Episodes”', async () => {
    series()
    const table = await openSeries()
    await userEvent.click(table.getByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    await userEvent.click(within(await menuOf('Season 1, 4K: 2 Wanted')).getByRole('menuitem', { name: /Show the 2 Wanted Episodes/ }))
    expect(screen.getByRole('tab', { name: /^Wanted/, selected: true })).toBeInTheDocument()
    await waitFor(() => expect(location.search).toContain('show=wanted'))
  })

  it('has a menu on an episode’s cell scoped to that episode and Version', async () => {
    series()
    const sent = recordSearches()
    const table = await openSeries()
    const rows = within(table.getByRole('rowgroup', { name: 'Season 1 episodes' }))
    await userEvent.click(rows.getByRole('button', { name: 'S01E02 4K: Wanted' }))
    await userEvent.click(within(await menuOf('S01E02 4K: Wanted')).getByRole('menuitem', { name: /Search S01E02 for 4K/ }))
    await waitFor(() => expect(sent).toEqual([{ version: 52, body: { season: 1, episode_ids: [3] } }]))
    // A Version that downloads the episode opens Activity; one that has a file shows its details.
    await userEvent.click(rows.getByRole('button', { name: 'S01E03 Standard: Downloading' }))
    expect(within(await menuOf('S01E03 Standard: Downloading')).getByRole('menuitem', { name: 'Open in Activity' })).toBeInTheDocument()
  })

  /** A Series with a complete season 1 and a season 2 not out yet, and a record of the Manual searches. */
  function twoSeasons() {
    const state = fakeSeries()
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 100), '4k': cell('filled', 100) } }),
      episode(5, 2, 1, 'Next', { air_date: null, cells: { standard: cell('unreleased'), '4k': cell('unreleased') } }),
    ]
    const manual: Posted[] = []
    server.use(
      http.post('/versions/{id}/releases', async ({ params, request, response }) => {
        manual.push({ version: Number(params.id), body: await request.json() })
        return response(200).json(releaseList())
      }),
    )
    return manual
  }

  it('has Manual Search on the cell of a complete season, and picking it opens Manual search for that Version and season', async () => {
    const manual = twoSeasons()
    const table = await openSeries()
    await userEvent.click(table.getByRole('button', { name: 'Season 1, Standard: 1 of 1' }))
    await userEvent.click(within(await menuOf('Season 1, Standard: 1 of 1')).getByRole('menuitem', { name: 'Manual Search Season 1 (Standard)…' }))
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1 } }]))
  })

  it('has Manual Search, and only that, on the cell of a season not out yet', async () => {
    const manual = twoSeasons()
    const table = await openSeries()
    await userEvent.click(table.getByRole('button', { name: 'Season 2, 4K: Not out yet' }))
    const menu = await menuOf('Season 2, 4K: Not out yet')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Manual Search Season 2 (4K)…' }))
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 2 } }]))
  })

  it('puts the episode’s own ⋯ menu on its row, with Search All Versions and Stop Monitoring Episode', async () => {
    series()
    const table = await openSeries()
    await userEvent.click(within(table.getByRole('rowgroup', { name: 'Season 1 episodes' })).getByRole('button', { name: 'S01E02 Actions' }))
    const names = within(await menuOf('S01E02 Actions'))
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(names.slice(0, 4)).toEqual([expect.stringContaining('Search All Versions'), 'Manual Search (Standard)…', 'Manual Search (4K)…', 'Stop Monitoring Episode'])
  })
})

describe('the Series table on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  })

  it('stacks the Version cards one per row with their short labels, over a table of narrow columns', async () => {
    series()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    const cards = within(await screen.findByRole('list', { name: 'Versions' }))
    expect(cards.getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Standard', '4K'])
    expect(await cards.findByText('STD')).toBeInTheDocument()
    const table = within(screen.getByRole('table', { name: 'Seasons' }))
    await waitFor(() => expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Season', 'STD', '4K']))
  })

  it('opens a cell’s actions as a bottom sheet titled with the season and Version', async () => {
    series()
    const sent = recordSearches()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('option', { name: /breaking bad/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Season 1, 4K: 2 Wanted' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Season 1 · 4K' }))
    expect(sheet.getByText('2 Wanted')).toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: /Search Season 1 for 4K/ }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].version).toBe(52)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Season 1 · 4K' })).not.toBeInTheDocument())
  })
})

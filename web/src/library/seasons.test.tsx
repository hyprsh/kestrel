import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { detail, row } from '../test/library'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { cell, episode, fakeSeries, pickSeason, seriesRow } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openSeries() {
  const state = fakeSeries()
  const view = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, view }
}

const filled = { standard: cell('filled', 100), '4k': cell('filled', 100) }
const params = () => new URLSearchParams(location.search)

beforeEach(() => history.replaceState(null, '', '/'))
afterEach(() => localStorage.clear())

describe('the season switcher on the Title page', () => {
  it('is one menu button listing every season and Specials with its filled count, and opens the latest season', async () => {
    const state = fakeSeries()
    state.get().episodes = [
      episode(1, 0, 1, 'Special'),
      episode(2, 1, 1, 'Pilot', { cells: filled }),
      episode(3, 1, 2, 'Cat', { cells: filled }),
      episode(4, 2, 1, 'Seven Thirty-Seven', { cells: { standard: cell('filled', 100), '4k': cell('wanted') } }),
      episode(5, 2, 2, 'Grilled'),
    ]
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Seasons: Season 2' })
    await userEvent.click(button)
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((t) => t.textContent)).toEqual(['Season 12/2', 'Season 20/2', 'Specials0/1'])
    expect(items.map((t) => t.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    await userEvent.keyboard('{Escape}')
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 2 episode 1' })).toBeInTheDocument()
    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
  })

  it('shows the episodes of the season picked, and keeps the season in the address bar', async () => {
    const { grid } = await openSeries()
    expect(params().get('season')).toBeNull()

    await pickSeason('Specials')

    expect(screen.getByRole('button', { name: 'Seasons: Specials' })).toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
    expect(within(grid).queryByRole('checkbox', { name: 'Tick Season 1 episode 1' })).not.toBeInTheDocument()
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?season=0'))
  })

  it('drops the season from the address when another Title is selected, a Movie included', async () => {
    const state = fakeSeries()
    const series = seriesRow(5, 'Breaking Bad')
    const movie = row(7, 'Heat', 'Heat')
    state.lib.rows = [series, movie]
    server.use(
      http.get('/titles/{id}', ({ params, response }) => response(200).json(Number(params.id) === 7 ? detail(movie) : detail(series, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' }))),
    )
    history.replaceState(null, '', '/library?season=0')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })
    await waitFor(() => expect(params().get('season')).toBe('0'))

    await userEvent.click(await screen.findByRole('option', { name: /heat/i }))

    await screen.findByRole('heading', { name: 'Heat' })
    await waitFor(() => expect(location.search).toBe(''))
  })

  it('opens the season the address names', async () => {
    history.replaceState(null, '', '/library?season=0')
    const { grid } = await openSeries()
    expect(screen.getByRole('button', { name: 'Seasons: Specials' })).toBeInTheDocument()
    expect(within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' })).toBeInTheDocument()
  })

  it('sums up the open season: filled and downloading episodes, and what is Wanted', async () => {
    const state = fakeSeries()
    const eps = state.get().episodes
    eps[1] = { ...eps[1], cells: { standard: cell('filled', 120), '4k': cell('filled', 120) } }
    eps.push(episode(4, 1, 3, 'Grey Matter', { cells: { standard: cell('downloading'), '4k': cell('wanted') } }))
    eps.push(episode(5, 1, 4, 'Crazy Handful', { cells: { standard: cell('wanted'), '4k': cell('wanted') } }))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('grid', { name: 'Episodes' })

    expect(screen.getByRole('button', { name: 'Seasons: Season 1' })).toBeInTheDocument()
    expect(document.body).toHaveTextContent('1 of 4 filled · 1 downloading · 2 Wanted')
  })

  it('has Search season in the toolbar, and Manual search season… and Reset column widths in the ⋯ menu', async () => {
    const { state } = await openSeries()
    expect(state.get().sent).toEqual([])
    expect(screen.getByRole('button', { name: 'Search season' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Manual search Season/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset column widths' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    expect(screen.getAllByRole('menuitem', { name: /^Manual search season…/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'Reset column widths' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  })

  it('offers Reset column widths in the ⋯ menu only while the widths differ, and resets them', async () => {
    localStorage.setItem('kestrel.columns.episodes', JSON.stringify({ name: 300 }))
    await openSeries()

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset column widths' }))

    expect(localStorage.getItem('kestrel.columns.episodes')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    expect(screen.queryByRole('menuitem', { name: 'Reset column widths' })).not.toBeInTheDocument()
  })

  it('monitors and unmonitors a whole season from its menu', async () => {
    const { state } = await openSeries()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Season 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unmonitor season' }))
    await waitFor(() => expect(state.get().sent).toEqual([{ path: 'seasons/1', body: { monitored: false } }]))
  })
})

describe('Find an episode', () => {
  const find = () => screen.getByRole('searchbox', { name: 'Find an episode' })

  it('takes a code in any spelling, switches to the season and highlights the episode, keeping it in the address bar', async () => {
    const { grid } = await openSeries()

    for (const code of ['s0e1', '0x01', 'S00E01']) {
      await pickSeason('Season 1')
      await userEvent.clear(find())
      await userEvent.type(find(), code)
      expect(screen.getByRole('button', { name: 'Seasons: Specials' })).toBeInTheDocument()
      const row = within(grid).getByRole('checkbox', { name: 'Tick Season 0 episode 1' }).closest('tr')!
      expect(row).toHaveAttribute('aria-current', 'true')
    }
    await waitFor(() => expect(location.pathname + location.search).toBe('/library?season=0&episode=1'))
  })

  it('finds part of a name and highlights only that episode', async () => {
    const { grid } = await openSeries()
    await userEvent.type(find(), "cat's")
    const row = (name: string) => within(grid).getByRole('checkbox', { name }).closest('tr')!
    expect(row('Tick Season 1 episode 2')).toHaveAttribute('aria-current', 'true')
    expect(row('Tick Season 1 episode 1')).not.toHaveAttribute('aria-current')
  })

  it('says when nothing matches, and clears the highlight when the field is cleared', async () => {
    const { grid } = await openSeries()
    await userEvent.type(find(), 's1e1')
    const row = within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' }).closest('tr')!
    expect(row).toHaveAttribute('aria-current', 'true')

    await userEvent.clear(find())
    expect(row).not.toHaveAttribute('aria-current')

    await userEvent.type(find(), 's9e9')
    expect(screen.getByRole('status')).toHaveTextContent('No episode matches "s9e9".')
  })

  it('opens on the episode the address names', async () => {
    history.replaceState(null, '', '/library?season=1&episode=2')
    const { grid } = await openSeries()
    await waitFor(() => expect(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }).closest('tr')).toHaveAttribute('aria-current', 'true'))
    expect(find()).toHaveValue('S01E02')
  })
})

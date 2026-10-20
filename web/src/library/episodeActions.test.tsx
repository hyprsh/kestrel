import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { version: number; body: unknown }

/** Breaking Bad (Standard 51, 4K 52) with Search now and Manual search answered and recorded. */
async function openSeries() {
  const state = fakeSeries()
  const searched: Posted[] = []
  const manual: Posted[] = []
  const read = async (r: Request) => {
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
  server.use(
    http.post('/versions/{id}/search', async ({ params, request, response }) => {
      searched.push({ version: Number(params.id), body: await read(request) })
      return response(202).empty()
    }),
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      manual.push({ version: Number(params.id), body: await read(request) })
      return response(200).json({ items: [], indexer_errors: [] })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { state, grid, searched, manual }
}

async function choose(grid: HTMLElement, menu: string, item: string) {
  await userEvent.click(within(grid).getByRole('button', { name: menu }))
  await userEvent.click(screen.getByRole('menuitem', { name: item }))
}

describe('searching from the episodes heat map', () => {
  it('searches one episode from its row, in each Slot that wants it', async () => {
    const { grid, searched } = await openSeries()

    await choose(grid, 'Actions for Season 1 episode 1', 'Search')

    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
    expect(await screen.findByText(/Searching S01E01/)).toBeInTheDocument()
  })

  it('cannot search an episode nothing wants', async () => {
    const { grid } = await openSeries()
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 2' }))
    expect(screen.getByRole('menuitem', { name: 'Search' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('opens Manual search for one episode in one Slot', async () => {
    const { grid, manual } = await openSeries()

    await choose(grid, 'Actions for Season 1 episode 1', 'Manual search 4K')

    const pane = await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(manual).toEqual([{ version: 52, body: { season: 1, episode_ids: [2] } }]))
    expect(within(pane).getByText('S01E01')).toBeInTheDocument()
  })

  it('searches a whole season and opens Manual search for it from the season row', async () => {
    const { grid, searched, manual } = await openSeries()

    await choose(grid, 'Actions for Season 1', 'Search season')
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { season: 1 } }]))

    await choose(grid, 'Actions for Season 1', 'Manual search season Standard')
    await waitFor(() => expect(manual).toEqual([{ version: 51, body: { season: 1 } }]))
    expect(within(await screen.findByRole('region', { name: 'Manual search' })).getByText('Season 1')).toBeInTheDocument()
  })

  it('ticks episodes, a range with shift-click, and searches them together', async () => {
    const { grid, searched } = await openSeries()

    await choose(grid, 'Actions for Season 0 episode 1', 'Tick')
    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(bar).toHaveTextContent('1 ticked')
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 2' }))
    await user.keyboard('{/Shift}')
    expect(bar).toHaveTextContent('3 ticked')

    await userEvent.click(within(bar).getByRole('button', { name: 'Search' }))

    // Only the 4K pilot is Wanted among the three.
    await waitFor(() => expect(searched).toEqual([{ version: 52, body: { episode_ids: [2] } }]))
  })

  it('opens a row menu from the keyboard and Escape closes it, back on the cell', async () => {
    const { grid } = await openSeries()
    const cell = within(grid).getByRole('img', { name: 'Season 1 episode 1 4K: Wanted' })
    cell.focus()

    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu', { name: 'Actions for Season 1 episode 1' })
    expect(within(menu).getByRole('menuitem', { name: 'Search' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(cell).toHaveFocus()
    // Escape stayed in the menu: the pane is still open.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })

  it('ticks the focused episode with x and Escape clears the ticks first', async () => {
    const { grid } = await openSeries()
    within(grid).getByRole('img', { name: 'Season 1 episode 1 Standard: Filled' }).focus()

    await userEvent.keyboard('x')
    expect(screen.getByRole('group', { name: 'Selection' })).toHaveTextContent('1 ticked')
    // The Library's own x (tick the Title, which swaps the pane for the bulk actions) did not fire.
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Selection' })).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Episodes' })).toBeInTheDocument()
  })
})

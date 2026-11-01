import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'
import { openTitleMenu } from '../test/titleHeader'

/** The Monitored button of the header, named by the state it shows. */
const MONITORING = /^Monitoring: /

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** A Library with one Movie whose PATCH /titles/{id} records the body and applies `monitored`. */
function fakeMovie() {
  const r = row(1, 'Heat', 'Heat')
  fakeLibrary([r])
  const state = { monitored: true, sent: [] as Sent[] }
  const unmonitored = () => (state.monitored ? r : { ...r, slots: { standard: { ...r.slots.standard!, state: 'unmonitored' as const }, '4k': null } })
  server.use(
    http.get('/titles/{id}', ({ response }) => response(200).json(detail(unmonitored(), { monitored: state.monitored }))),
    http.patch('/titles/{id}', async ({ request, response }) => {
      const body = await request.json()
      state.sent.push({ path: 'titles', body })
      if (body.monitored !== undefined) state.monitored = body.monitored
      return response(200).json(detail(unmonitored(), { monitored: state.monitored }))
    }),
  )
  return state
}

describe('monitoring a Movie', () => {
  it('shows a green Monitored button that stops monitoring; an unmonitored Movie gets a muted header with Monitor in place of Search', async () => {
    const state = fakeMovie()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Heat' })
    const button = await within(pane).findByRole('button', { name: 'Monitored' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(within(pane).getByRole('button', { name: 'Search Standard' })).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Monitor' })).not.toBeInTheDocument()
    expect(pane.querySelector('[data-muted]')).toBeNull()

    await userEvent.click(button)

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { monitored: false } }]))
    const off = await within(pane).findByRole('button', { name: 'Not monitored' })
    expect(off).toHaveAttribute('aria-pressed', 'false')
    expect(pane.querySelector('[data-muted]')).not.toBeNull() // the poster is muted
    expect(within(pane).getByText(/^Kestrel keeps its file and searches nothing\./)).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Search Standard' })).not.toBeInTheDocument()
    // Search moved into the Title menu, disabled with the reason.
    const menu = await openTitleMenu(pane)
    expect(within(menu).getByRole('menuitem', { name: /^Search Wanted/ })).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByRole('menuitem', { name: /^Search Wanted/ })).toHaveTextContent('Not monitored: turn monitoring on to search')
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(pane).getByRole('button', { name: 'Monitor' }))

    await waitFor(() => expect(state.sent[1]).toEqual({ path: 'titles', body: { monitored: true } }))
    expect(await within(pane).findByRole('button', { name: 'Monitored' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pane).getByRole('button', { name: 'Search Standard' })).toBeInTheDocument()
  })
})

describe('monitoring a Series', () => {
  it('has a Monitored · all episodes button next to Search, not on the meta line, with the three modes and two switches in its menu', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    const button = await within(pane).findByRole('button', { name: MONITORING })
    expect(button).toHaveTextContent('Monitored · all episodes')
    expect(within(pane).getByRole('button', { name: 'Search Wanted' })).toBeInTheDocument()
    expect(within(pane).getByText(/^Kestrel searches every Wanted episode and grabs new ones as they air\./)).toBeInTheDocument()
    expect(within(pane).getByText(/1 Special is not monitored\./)).toBeInTheDocument()

    await userEvent.click(button)
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((o) => o.textContent),
    ).toEqual([
      'All episodesSearch the past ones that are missing, and new ones',
      'Future episodes onlyLeave what aired before; grab what airs from now',
      'Not monitoredKeep the files, search nothing',
    ])
    expect(within(menu).getByRole('menuitemradio', { name: /^All episodes/ })).toBeChecked()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Monitor new seasons' })).toBeChecked()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Monitor Specials' })).not.toBeChecked()

    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /^Future episodes only/ }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'future' } }))
    await waitFor(() => expect(within(pane).getByRole('button', { name: MONITORING })).toHaveTextContent('Monitored · future episodes'))
  })

  it('turns Monitor new seasons and Monitor Specials on and off', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    await userEvent.click(await within(pane).findByRole('button', { name: MONITORING }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Monitor Specials' }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { monitor_specials: true } }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Monitor new seasons' }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { monitor_new_seasons: false } }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Monitor Specials' })).toBeChecked()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Monitor new seasons' })).not.toBeChecked()
  })

  it('has no Monitoring… item in the Title menu any more', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    const menu = await openTitleMenu(pane)
    expect(within(menu).queryByRole('menuitem', { name: /^Monitoring…/ })).not.toBeInTheDocument()
  })
})

describe('a Series that is not monitored', () => {
  it('shows an outline Not monitored button and says why Search Wanted is disabled', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: MONITORING }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^Not monitored/ }))

    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'none' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: MONITORING })).toHaveTextContent('Not monitored'))
    expect(screen.getByText('Kestrel keeps the files and searches nothing.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: MONITORING }))
    expect(screen.getByRole('menuitemradio', { name: /^Not monitored/ })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: /^All episodes/ })).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    const search = screen.getByRole('button', { name: 'Search Wanted' })
    expect(search).toBeDisabled()
    expect(search).toHaveAttribute('title', 'Not monitored: turn monitoring on to search')
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'
import { chooseTitleItem, openTitleMenu } from '../test/titleHeader'

/** The items of the menu a trigger opened. */
const itemsOf = (trigger: HTMLElement) =>
  within(document.getElementById(trigger.getAttribute('aria-controls')!)!)
    .getAllByRole('menuitemradio')
    .map((o) => o.textContent)

/** The monitoring dropdown of the meta line, named by the state it shows. */
const MONITORING = /^(Monitored|Monitoring|Not monitored)/

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
  it('unmonitors from the Title menu’s Monitoring… and monitors again from the meta line', async () => {
    const state = fakeMovie()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Heat' })
    expect(within(pane).queryByRole('button', { name: MONITORING })).not.toBeInTheDocument()

    await chooseTitleItem(pane, /^Monitoring…/)
    const dialog = await screen.findByRole('dialog', { name: 'Monitoring' })
    expect(within(dialog).getByRole('radio', { name: 'Monitored' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Not monitored' }))

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { monitored: false } }]))
    const menu = await within(pane).findByRole('button', { name: 'Not monitored' })
    expect(screen.queryByRole('dialog', { name: 'Monitoring' })).not.toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Search Wanted' })).toBeDisabled()

    await userEvent.click(menu)
    expect(itemsOf(menu)).toEqual(['Monitored', 'Not monitored'])
    expect(screen.getByRole('menuitemradio', { name: 'Not monitored' })).toBeChecked()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Monitored' }))

    await waitFor(() => expect(state.sent[1]).toEqual({ path: 'titles', body: { monitored: true } }))
    await waitFor(() => expect(within(pane).queryByRole('button', { name: MONITORING })).not.toBeInTheDocument())
  })
})

describe('monitoring a Series', () => {
  it('sits on the meta line, not in the episode section, and offers the three modes', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const select = await screen.findByRole('button', { name: MONITORING })
    await userEvent.click(select)
    expect(select).toHaveTextContent('Monitoring all episodes')
    expect(itemsOf(select)).toEqual(['Monitoring all episodes', 'Monitoring future episodes', 'Not monitored'])
    expect(screen.getByRole('menuitemradio', { name: 'Monitoring all episodes' })).toBeChecked()
    expect(screen.queryByRole('region', { name: 'Seasons' })).not.toContainElement(select)
    expect(screen.queryByRole('checkbox', { name: 'Monitored' })).not.toBeInTheDocument()
  })

  it('changes the mode from the Title menu’s Monitoring… too, which names the current one', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Breaking Bad' })
    const menu = await openTitleMenu(pane)
    expect(within(menu).getByRole('menuitem', { name: /^Monitoring…/ })).toHaveTextContent('all episodes')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Monitoring…/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Monitoring' })
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['all', 'future', 'none'])
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Monitoring future episodes' }))
    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'future' } }))
  })
})

describe('a Series that is not monitored', () => {
  it('says so on the meta line and says why Search Wanted is disabled', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: MONITORING }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Not monitored' }))

    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'none' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: MONITORING })).toHaveTextContent('Not monitored'))
    await userEvent.click(screen.getByRole('button', { name: MONITORING }))
    expect(screen.getByRole('menuitemradio', { name: 'Not monitored' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Monitoring all episodes' })).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    const search = screen.getByRole('button', { name: 'Search Wanted' })
    expect(search).toBeDisabled()
    expect(search).toHaveAttribute('title', 'Not monitored: turn monitoring on to search')
  })
})

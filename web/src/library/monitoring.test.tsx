import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'

/** The items of the menu a trigger opened. */
const itemsOf = (trigger: HTMLElement) =>
  within(document.getElementById(trigger.getAttribute('aria-controls')!)!)
    .getAllByRole('menuitemradio')
    .map((o) => o.textContent)

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
  it('unmonitors and monitors again from the detail pane', async () => {
    const state = fakeMovie()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const menu = await screen.findByRole('button', { name: /^Monitoring/ })
    await userEvent.click(menu)
    expect(menu).toHaveTextContent('Monitored')
    expect(itemsOf(menu)).toEqual(['Monitored', 'Not monitored'])
    expect(screen.getByRole('menuitemradio', { name: 'Monitored' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Not monitored' })).not.toBeChecked()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Not monitored' }))

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { monitored: false } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Monitoring/ })).toHaveTextContent('Not monitored'))
    expect(screen.getByText('Kestrel leaves this Movie as it is: no searches, Grabs or Upgrades.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Monitoring/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Monitored' }))

    await waitFor(() => expect(state.sent[1]).toEqual({ path: 'titles', body: { monitored: true } }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Monitoring/ })).toHaveTextContent(/^Monitored$/))
  })
})

describe('monitoring a Series', () => {
  it('sits in the Title actions row, not in the episode section, and offers the three modes', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const select = await screen.findByRole('button', { name: /^Monitoring/ })
    expect(select.closest('[role=group]')).toHaveAccessibleName('Title actions')
    await userEvent.click(select)
    expect(select).toHaveTextContent('Monitored: all episodes')
    expect(select).toHaveAccessibleName('Monitoring: Monitored: all episodes')
    expect(itemsOf(select)).toEqual(['Monitored: all episodes', 'Monitored: future episodes', 'Not monitored'])
    expect(screen.getByRole('menuitemradio', { name: 'Monitored: all episodes' })).toBeChecked()
    expect(within(await screen.findByRole('region', { name: 'Episodes' })).queryByRole('button', { name: /^Monitoring/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Monitored' })).not.toBeInTheDocument()
  })
})

describe('a Series that is not monitored', () => {
  it('says so in the row control and says why Search now is disabled', async () => {
    const fake = fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Monitoring/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Not monitored' }))

    await waitFor(() => expect(fake.get().sent).toContainEqual({ path: 'titles', body: { series_monitor: 'none' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Monitoring/ })).toHaveTextContent('Not monitored'))
    expect(screen.getByRole('button', { name: 'Monitoring: Not monitored' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Monitoring/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Not monitored' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Monitored: all episodes' })).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Search now' })).toBeDisabled()
    expect(screen.getByText('Not monitored: turn monitoring on to search')).toBeInTheDocument()
  })
})

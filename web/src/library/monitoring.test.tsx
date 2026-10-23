import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'

/** The options of the dropdown a trigger opened. */
const optionsOf = (trigger: HTMLElement) => within(document.getElementById(trigger.getAttribute('aria-controls')!)!).getAllByRole('option').map((o) => o.textContent)

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
    const menu = await screen.findByRole('button', { name: 'Monitor: Monitored' })
    await userEvent.click(menu)
    expect(optionsOf(menu)).toEqual(['Monitored', 'Not monitored'])
    expect(screen.getByRole('option', { name: 'Monitored' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('option', { name: 'Not monitored' }))

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { monitored: false } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monitor: Not monitored' })).toBeInTheDocument())
    expect(screen.getByText('Kestrel leaves this Movie as it is: no searches, Grabs or Upgrades.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Monitor: Not monitored' }))
    await userEvent.click(screen.getByRole('option', { name: 'Monitored' }))

    await waitFor(() => expect(state.sent[1]).toEqual({ path: 'titles', body: { monitored: true } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monitor: Monitored' })).toBeInTheDocument())
  })

})

describe('monitoring a Series', () => {
  it('sits in the Title actions row, not in the episode section, and offers the three modes', async () => {
    fakeSeries()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const select = await screen.findByRole('button', { name: 'Monitor: All episodes' })
    expect(select.closest('[role=group]')).toHaveAccessibleName('Title actions')
    await userEvent.click(select)
    expect(optionsOf(select)).toEqual(['All episodes', 'Future episodes only', 'None'])
    expect(within(await screen.findByRole('region', { name: 'Episodes' })).queryByRole('button', { name: /^Monitor:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Monitored' })).not.toBeInTheDocument()
  })
})

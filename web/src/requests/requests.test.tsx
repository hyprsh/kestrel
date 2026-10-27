import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { http } from '../test/handlers'
import { fakeRequests, request } from '../test/requests'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const openRequests = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^View all \d+ →$/ }))
  return screen.findByRole('combobox', { name: 'Filter Requests' })
}

const list = () => screen.findByRole('list', { name: 'Requests' })

describe('the Requests screen', () => {
  it('opens from the Overview’s View all and lists every Request the same way', async () => {
    fakeRequests(Array.from({ length: 7 }, (_, i) => request({ id: 10 - i, title: `Movie ${i + 1}` })))
    renderApp()

    expect(await openRequests()).toHaveValue('')
    const rows = await within(await list()).findAllByRole('listitem')
    expect(rows).toHaveLength(7)
    expect(rows[0]).toHaveTextContent('Movie 1')
    expect(rows[0]).toHaveTextContent('Anna via Silo · 2 h ago')
    expect(rows[0]).toHaveTextContent('Standard · Searching')
    expect(location.pathname).toBe('/requests')
  })

  it('names the source of a Watchlist Request "Watchlist"', async () => {
    fakeRequests([request({ id: 5, source: 'plex_watchlist', title: 'Dune' })])
    renderApp()

    await openRequests()
    expect(await within(await list()).findByRole('listitem')).toHaveTextContent('Anna via Watchlist')
  })

  it('asks the server for the status, requester and source the filter names', async () => {
    const queries = fakeRequests([request()])
    renderApp()
    const field = await openRequests()

    await userEvent.type(field, 'status:open,rejected requester:Ben source:silo ')

    await waitFor(() => {
      const q = queries.at(-1)!
      expect(q.getAll('status')).toEqual(['open', 'rejected'])
      expect(q.getAll('requester')).toEqual(['Ben'])
      expect(q.getAll('source')).toEqual(['silo'])
    })
    expect(location.search).toContain('q=')
  })

  it('narrows the loaded rows by free text on the Title and who asked', async () => {
    fakeRequests([request({ id: 2, title: 'Dune' }), request({ id: 1, title: 'Paddington', requester: { id: 'u-2', name: 'Ben' } })])
    renderApp()
    const field = await openRequests()
    await within(await list()).findAllByRole('listitem')

    await userEvent.type(field, 'ben')

    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Requests' })).getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('list', { name: 'Requests' })).toHaveTextContent('Paddington')
  })

  it('loads older Requests a page at a time', async () => {
    fakeRequests(Array.from({ length: 60 }, (_, i) => request({ id: 100 - i, title: `Movie ${i + 1}` })))
    renderApp()
    await openRequests()
    expect(await within(await list()).findAllByRole('listitem')).toHaveLength(50)

    await userEvent.click(screen.getByRole('button', { name: 'Show older Requests' }))

    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Requests' })).getAllByRole('listitem')).toHaveLength(60))
    expect(screen.queryByRole('button', { name: 'Show older Requests' })).not.toBeInTheDocument()
  })

  it('shows a busy state on Show older Requests while the next page loads', async () => {
    const items = Array.from({ length: 60 }, (_, i) => request({ id: 100 - i, title: `Movie ${i + 1}` }))
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.get('/requests', async ({ request: r, response }) => {
        const from = Number(new URL(r.url).searchParams.get('cursor') ?? 0)
        if (from > 0) await gate
        const to = from + 50
        return response(200).json({ items: items.slice(from, to), next_cursor: to < items.length ? String(to) : null, total: items.length })
      }),
    )
    renderApp()
    await openRequests()
    await within(await list()).findAllByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: 'Show older Requests' }))

    expect(await screen.findByRole('button', { name: 'Show older Requests' })).toHaveAttribute('aria-busy', 'true')
    release()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older Requests' })).not.toBeInTheDocument())
  })

  it('marks the cursor row with aria-current and moves it, scrolled into view, with j and k', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fakeRequests([request({ id: 2, title: 'Dune' }), request({ id: 1, title: 'Paddington' })])
    renderApp()
    await openRequests()
    const rows = await within(await list()).findAllByRole('listitem')
    ;(document.activeElement as HTMLElement).blur()
    const current = () => document.querySelector('[aria-current="true"]')

    expect(current()).toBe(rows[0])
    await userEvent.keyboard('j')
    expect(current()).toBe(rows[1])
    expect(scroll.mock.contexts.at(-1)).toBe(rows[1])
    await userEvent.keyboard('k')
    expect(current()).toBe(rows[0])
  })

  it('opens the Title from a row', async () => {
    fakeRequests([request({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()
    await openRequests()

    await userEvent.click(within((await within(await list()).findAllByRole('listitem'))[0]).getAllByRole('button', { hidden: true })[0]) // the row's whole-row button

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('opens filtered from its address', async () => {
    history.replaceState(null, '', '/requests?q=status%3Arejected')
    const queries = fakeRequests([request()])
    renderApp()

    expect(await screen.findByRole('combobox', { name: 'Filter Requests' })).toHaveValue('status:rejected')
    await waitFor(() => expect(queries.some((q) => q.getAll('status').join() === 'rejected')).toBe(true))
  })
})

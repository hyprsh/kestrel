import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeRequests, request } from '../test/requests'

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

  it('opens the Title from a row', async () => {
    fakeRequests([request({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()
    await openRequests()

    await userEvent.click((await within(await list()).findAllByRole('listitem'))[0])

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

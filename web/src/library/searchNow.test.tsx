import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeSeries } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Posted = { path: string; version: number; body: unknown }

/** Records Search now and Manual search calls; with `gone` Search now answers 404. */
function recordSearches({ gone = false } = {}) {
  const sent: Posted[] = []
  const read = async (r: Request) => {
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
  server.use(
    http.post('/versions/{id}/search', async ({ params, request, response }) => {
      sent.push({ path: 'search', version: Number(params.id), body: await read(request) })
      if (gone) return response(404).json({ type: 'about:blank', title: 'not found', status: 404, code: 'not_found', detail: 'no such Version' })
      return response(202).empty()
    }),
    http.post('/versions/{id}/releases', async ({ params, request, response }) => {
      sent.push({ path: 'releases', version: Number(params.id), body: await read(request) })
      return response(200).json({ items: [], indexer_errors: [] })
    }),
  )
  return sent
}

async function openVersion(title: RegExp, slot: string) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: title })
  return within(pane).findByRole('group', { name: slot })
}

describe('Search now on the Title page', () => {
  it('searches a Wanted Movie Version at once and says the Log will show what it grabs', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const sent = recordSearches()
    const hd = await openVersion(/paddington/i, 'Standard')

    await userEvent.click(within(hd).getByRole('button', { name: 'Search now' }))

    await waitFor(() => expect(sent).toEqual([{ path: 'search', version: 11, body: null }]))
    expect(await within(hd).findByText(/Searching… The Log shows what it grabs/)).toBeInTheDocument()
  })

  it('cannot search a Version that wants nothing', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington', { slots: { standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null } })])
    recordSearches()
    const hd = await openVersion(/paddington/i, 'Standard')

    expect(within(hd).getByRole('button', { name: 'Search now' })).toBeDisabled()
  })

  it('says why a search could not start', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    recordSearches({ gone: true })
    const hd = await openVersion(/paddington/i, 'Standard')

    await userEvent.click(within(hd).getByRole('button', { name: 'Search now' }))

    expect(await within(hd).findByRole('alert')).toHaveTextContent('no such Version')
  })

  it('offers Search now and a whole-Series Manual search for a Series Version', async () => {
    fakeSeries()
    const sent = recordSearches()
    const uhd = await openVersion(/breaking bad/i, '4K')

    await userEvent.click(within(uhd).getByRole('button', { name: 'Search now' }))
    await waitFor(() => expect(sent).toEqual([{ path: 'search', version: 52, body: null }]))

    await userEvent.click(within(uhd).getByRole('button', { name: 'Manual search' }))
    await screen.findByRole('region', { name: 'Manual search' })
    await waitFor(() => expect(sent).toContainEqual({ path: 'releases', version: 52, body: null }))
  })
})

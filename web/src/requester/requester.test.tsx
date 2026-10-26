import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { Request } from '../api/requests'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { problem, recordPaths, requesterMe } from '../test/plex'
import { request, requestSlot } from '../test/requests'
import { server } from '../test/server'

type Lookup = components['schemas']['LookupResult']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const result = (over: Partial<Lookup> = {}): Lookup => ({
  kind: 'movie',
  tmdb_id: 1,
  tvdb_id: null,
  title: 'Dune',
  year: 2021,
  poster: null,
  in_library: null,
  addable: true,
  not_addable_reason: null,
  ratings: [],
  ...over,
})

/** A Requester's session over a server holding their Requests and answering searches with `found`. */
function fakeRequester(opts: { mine?: Request[]; found?: (q: string) => Lookup[]; makeFails?: boolean } = {}) {
  let signedIn = true
  const mine = [...(opts.mine ?? [])]
  const made: unknown[] = []
  const recorded = recordPaths()
  server.use(
    http.get('/auth/me', ({ response }) => (signedIn ? response(200).json(requesterMe) : response('default').json(problem(401, 'unauthenticated'), { status: 401 }))),
    http.get('/auth/plex', ({ response }) => response(200).json({ enabled: true })),
    http.post('/auth/logout', ({ response }) => {
      signedIn = false
      return response(204).empty()
    }),
    http.get('/lookup', ({ request: r, response }) => {
      const items = (opts.found ?? (() => []))(new URL(r.url).searchParams.get('q') ?? '')
      return response(200).json({ items, next_cursor: null, did_you_mean: null })
    }),
    http.get('/my/requests', ({ response }) => response(200).json({ items: mine, next_cursor: null, total: mine.length })),
    http.post('/my/requests', async ({ request: r, response }) => {
      if (opts.makeFails) return response('default').json(problem(500, 'internal'), { status: 500 })
      const body = (await r.json()) as { kind: string; tmdb_id: number }
      made.push(body)
      const created = request({ id: 100, source: 'plex', requester: { id: '1', name: 'anna' }, title: 'Dune', title_id: 77, slots: [requestSlot()] })
      mine.unshift(created)
      return response(201).json(created)
    }),
  )
  return { made, ...recorded }
}

const search = async (text: string) => {
  await userEvent.type(await screen.findByRole('searchbox', { name: 'Title' }), text)
}

describe('the Requester app', () => {
  it('replaces the admin Shell and calls only what a Requester may', async () => {
    const { paths, stop } = fakeRequester()
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Your Requests' })).toBeInTheDocument()
    expect(screen.getByText('anna')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()

    await search('dune')
    await screen.findByText('No Movie or Series found.')
    const allowed = ['GET /auth/me', 'GET /auth/plex', 'POST /auth/logout', 'GET /system', 'GET /lookup', 'GET /my/requests', 'POST /my/requests']
    expect(paths.filter((p) => !allowed.includes(p))).toEqual([])
    stop()
  })

  it('logs out', async () => {
    const { stop } = fakeRequester()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    stop()
  })

  it('searches, makes a Request and shows its status in both lists', async () => {
    const { made, stop } = fakeRequester({
      found: () => [result({ tmdb_id: 438631 })].map((r) => (made.length > 0 ? { ...r, in_library: 77 } : r)),
    })
    renderApp()
    await search('dune')

    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Dune')).toBeInTheDocument()
    expect(within(results).getByText('2021 · Movie')).toBeInTheDocument()
    await userEvent.click(within(results).getByRole('button', { name: 'Request Dune' }))

    expect(made).toEqual([{ kind: 'movie', tmdb_id: 438631 }])
    const mine = await screen.findByRole('list', { name: 'Your Requests' })
    expect(within(mine).getByText('Dune')).toBeInTheDocument()
    expect(within(mine).getByText('Searching')).toBeInTheDocument()
    expect(await within(await screen.findByRole('list', { name: 'Search results' })).findByText('Searching')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request Dune' })).not.toBeInTheDocument()
    stop()
  })

  it('says when a Request could not be made', async () => {
    const { stop } = fakeRequester({ found: () => [result()], makeFails: true })
    renderApp()
    await search('dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Request Dune' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not make the request/i)
    expect(screen.getByRole('button', { name: 'Request Dune' })).toBeEnabled()
    stop()
  })

  it('shows In Library, a Title another Request covers, and why a Title cannot be Requested', async () => {
    const own = request({ id: 5, title_id: 9, title: 'Arrival', slots: [requestSlot({ status: 'completed', status_label: 'Completed' })] })
    const { stop } = fakeRequester({
      mine: [own],
      found: () => [
        result({ tmdb_id: 1, title: 'Heat', in_library: 3 }),
        result({ tmdb_id: 2, title: 'Arrival', in_library: 9 }),
        result({ kind: 'series', tmdb_id: 3, title: 'Obscure Show', year: null, addable: false, not_addable_reason: 'not_on_tvdb' }),
        result({ tmdb_id: 4, title: 'Alien' }),
      ],
    })
    renderApp()
    await search('a')

    const results = await screen.findByRole('list', { name: 'Search results' })
    const rows = within(results).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('In Library')
    expect(rows[1]).toHaveTextContent('Completed')
    expect(rows[2]).toHaveTextContent('Obscure Show')
    expect(rows[2]).toHaveTextContent('Series')
    expect(rows[2]).toHaveTextContent('Not on TheTVDB')
    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[3]).getByRole('button', { name: 'Request Alien' })).toBeInTheDocument()
    stop()
  })

  it('lists Your Requests with where each stands, and why a rejected one was turned down', async () => {
    const { stop } = fakeRequester({
      mine: [
        request({
          id: 4,
          title: 'Heat',
          slots: [requestSlot({ status: 'downloading', status_label: 'Downloading', download: { phase: 'downloading', bytes_total: 1000, bytes_left: 600, eta: 60 } })],
        }),
        request({ id: 3, title: 'Arrival', slots: [requestSlot({ status: 'completed', status_label: 'Completed' })] }),
        request({ id: 2, title: 'Tulsa King', seasons: [], outcome: 'rejected', reject_reason: 'not_on_tvdb', title_id: null, slots: [] }),
        request({ id: 1, title: 'Gone', outcome: 'rejected', reject_reason: 'no_enabled_profile', title_id: null, slots: [] }),
      ],
    })
    renderApp()

    const rows = within(await screen.findByRole('list', { name: 'Your Requests' })).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Heat')
    expect(rows[0]).toHaveTextContent('Downloading 40%')
    expect(rows[0]).toHaveTextContent('Asked 2 h ago')
    expect(rows[1]).toHaveTextContent('Completed')
    expect(rows[2]).toHaveTextContent('Rejected')
    expect(rows[2]).toHaveTextContent('TheTVDB does not list this Series')
    expect(rows[3]).toHaveTextContent('Ask whoever runs Kestrel')
    stop()
  })

  it('invites the first Request when there are none', async () => {
    const { stop } = fakeRequester()
    renderApp()
    expect(await screen.findByText(/have not asked for anything yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Your Requests' })).not.toBeInTheDocument()
    stop()
  })

  it('says when the search fails', async () => {
    const { stop } = fakeRequester()
    server.use(http.get('/lookup', ({ response }) => response('default').json(problem(502, 'upstream_unavailable'), { status: 502 })))
    renderApp()
    await search('dune')
    expect(await screen.findByRole('alert')).toHaveTextContent(/search failed/i)
    stop()
  })
})

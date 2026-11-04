import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

type LastSearch = components['schemas']['LastSearch']

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000 - 1000).toISOString()

/** A Movie that has been Wanted for 12 days, its Version carrying `last` and `next`. */
function wantedMovie(last: LastSearch | null, next: string | null) {
  const r = row(1, 'Paddington', 'Paddington')
  fakeLibrary([r])
  server.use(
    http.get('/titles/{id}', ({ response }) => {
      const d = detail(r)
      return response(200).json({
        ...d,
        versions: d.versions.map((v) => ({ ...v, state: 'wanted', wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString(), last_search: last, next_search_at: next })),
      })
    }),
  )
}

async function openMovie() {
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  await within(pane).findByRole('button', { name: 'Title actions' })
  return within(await within(pane).findByRole('listitem', { name: 'Standard' }))
}

const none: LastSearch = { at: hoursAgo(2), releases: 23, outcome: 'nothing_fit', reasons: [{ code: 'language', detail: 'German', count: 23 }], upgrade: false }

describe('a Wanted Version’s search line', () => {
  it('says how long it has been Wanted and when the next search is, and when it was last searched and why none fit, with the full text as a tooltip', async () => {
    wantedMovie(none, hoursAhead(4))
    const card = await openMovie()

    expect(await card.findByText(/^Wanted 12 days/)).toHaveTextContent('next search in 4 h')
    const line = card.getByText(/^Last search 2 h ago/)
    expect(line).toHaveTextContent('Last search 2 h ago · 23 releases, all German only')
    expect(line).toHaveAttribute('title', line.textContent!)
  })

  it('says it was not searched yet', async () => {
    wantedMovie(null, hoursAhead(1))
    const card = await openMovie()

    expect(await card.findByText('Not searched yet')).toBeInTheDocument()
  })

  it.each([
    ['no_indexer', 'no indexer is turned on', 0],
    ['error', 'the search failed', 0],
    ['nothing_fit', 'nothing found yet', 0],
  ] as const)('puts a %s search in words', async (outcome, words, releases) => {
    wantedMovie({ at: hoursAgo(1), releases, outcome, reasons: [], upgrade: false }, null)
    const card = await openMovie()

    expect(await card.findByText(`Last search 1 h ago · ${words}`)).toBeInTheDocument()
  })

  it('searches from the card', async () => {
    wantedMovie(none, hoursAhead(4))
    const searched: string[] = []
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (searched.push(String(params.id)), response(202).json({ search_id: 'search-1' }))))
    const card = await openMovie()

    await userEvent.click(await card.findByRole('button', { name: 'Search Now' }))

    await waitFor(() => expect(searched).toHaveLength(1))
  })

  it('shows nothing of a search for a Version that has a file', async () => {
    const r = row(1, 'Paddington', 'Paddington', { slots: { standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null } })
    fakeLibrary([r])
    const card = await openMovie()

    await card.findByText(/BluRay|Have/)
    expect(card.queryByText(/^Last search/)).not.toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Search Now' })).not.toBeInTheDocument()
  })

  it('puts the same line under a Series Version’s state while it has Wanted episodes', async () => {
    fakeSeries()
    const r = seriesRow(5, 'Breaking Bad')
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189 })
        return response(200).json({
          ...d,
          versions: d.versions.map((v) => ({
            ...v,
            state: 'wanted',
            coverage: { episodes: 9, filled: 7, wanted: 2, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 0 },
            last_search: { ...none, releases: 20, reasons: [], upgrade: false },
            next_search_at: hoursAhead(4),
          })),
        })
      }),
    )
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const head = within(await screen.findByRole('listitem', { name: 'Standard' }))

    expect(await head.findByText(/^2 Wanted/)).toHaveTextContent('2 Wanted · next search in 4 h')
    expect(head.getByText(/^Last search 2 h ago/)).toHaveTextContent('Last search 2 h ago · 20 releases, none fit the Profile')
  })
})

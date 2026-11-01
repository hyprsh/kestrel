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
  return within(within(pane).getByRole('listitem', { name: 'Standard' }))
}

const none: LastSearch = { at: hoursAgo(2), releases: 23, outcome: 'nothing_fit', reasons: [{ code: 'language', detail: 'German', count: 23 }], upgrade: false }

describe('a Wanted Version’s search facts', () => {
  it('says when it was last searched, what came back and when the next search is', async () => {
    wantedMovie(none, hoursAhead(4))
    const card = await openMovie()

    expect(await card.findByText('Wanted for 12 days')).toBeInTheDocument()
    expect(card.getByText(/Last searched 2 h ago · 23 releases, none fit the Profile/)).toHaveTextContent('Last searched 2 h ago · 23 releases, none fit the Profile · Why? · next search in 4 h')
  })

  it('says it was not searched yet', async () => {
    wantedMovie(null, hoursAhead(1))
    const card = await openMovie()

    expect(await card.findByText(/^Not searched yet/)).toHaveTextContent('Not searched yet · Why? · next search in 1 h')
  })

  it.each([
    ['grabbed', 0, '37 releases, grabbed one', 37],
    ['no_indexer', 0, 'no indexer is turned on', 0],
    ['error', 0, 'the search failed', 0],
    ['nothing_fit', 0, 'no releases came back', 0],
  ] as const)('puts a %s search in words', async (outcome, _x, words, releases) => {
    wantedMovie({ at: hoursAgo(1), releases, outcome, reasons: [], upgrade: false }, null)
    const card = await openMovie()

    expect(await card.findByText(new RegExp(`Last searched 1 h ago · ${words}`))).toBeInTheDocument()
  })

  it('opens “Why is it Wanted?” from the Why? link with the state, the time, the main rejection reasons and the next search', async () => {
    wantedMovie(
      {
        ...none,
        reasons: [
          { code: 'language', detail: 'German', count: 23 },
          { code: 'below_min_score', detail: null, count: 6 },
        ],
      },
      hoursAhead(4),
    )
    const card = await openMovie()

    await userEvent.click(await card.findByRole('button', { name: 'Why?' }))

    const why = await screen.findByRole('dialog', { name: 'Why is it Wanted?' })
    expect(within(why).getByText('It has no file.')).toBeInTheDocument()
    expect(within(why).getByText(/^Wanted for 12 days, since /)).toBeInTheDocument()
    expect(within(why).getByText('2 h ago: 23 releases, none fit the Profile')).toBeInTheDocument()
    expect(within(why).getByText('23 German only · 6 below the cutoff')).toBeInTheDocument()
    expect(within(why).getByText('In 4 h')).toBeInTheDocument()
  })

  it('opens the same popover from the Version’s menu', async () => {
    wantedMovie(none, hoursAhead(4))
    const card = await openMovie()

    await userEvent.click(await card.findByRole('button', { name: 'Standard Version actions' }))
    await userEvent.click(within(screen.getByRole('menu', { name: 'Standard Version actions' })).getByRole('menuitem', { name: 'Why is it Wanted?' }))

    expect(await screen.findByRole('dialog', { name: 'Why is it Wanted?' })).toBeInTheDocument()
  })

  it('searches from the popover', async () => {
    wantedMovie(none, hoursAhead(4))
    const searched: string[] = []
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (searched.push(String(params.id)), response(202).empty())))
    const card = await openMovie()

    await userEvent.click(await card.findByRole('button', { name: 'Why?' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Why is it Wanted?' })).getByRole('button', { name: 'Search Now' }))

    await waitFor(() => expect(searched).toHaveLength(1))
  })

  it('shows nothing of a search for a Version that has a file', async () => {
    const r = row(1, 'Paddington', 'Paddington', { slots: { standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null } })
    fakeLibrary([r])
    const card = await openMovie()

    expect(card.queryByRole('button', { name: 'Why?' })).not.toBeInTheDocument()
    expect(card.queryByText(/Last searched/)).not.toBeInTheDocument()
  })

  it('puts the same line on a Series card that has Wanted episodes', async () => {
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
            last_search: none,
            next_search_at: hoursAhead(4),
          })),
        })
      }),
    )
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /breaking bad/i })

    const card = within(await within(pane).findByRole('listitem', { name: 'Standard' }))
    expect(await card.findByText(/Last searched 2 h ago/)).toHaveTextContent('Last searched 2 h ago · 23 releases, none fit the Profile · Why? · next search in 4 h')
    await userEvent.click(card.getByRole('button', { name: 'Why?' }))
    expect(within(await screen.findByRole('dialog', { name: 'Why is it Wanted?' })).getByText('2 episodes have no file, or a file that no longer fits the Profile.')).toBeInTheDocument()
  })
})

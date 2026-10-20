import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Release = components['schemas']['Release']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const release = (id: string, name: string, over: Partial<Release> = {}): Release => ({
  release_id: id,
  name,
  indexer: 'Alpha',
  size: 8 * 1024 ** 3,
  published_at: '2026-10-16T12:00:00Z',
  quality: 'Bluray-1080p',
  languages: ['English'],
  custom_formats: [],
  score: 0,
  fits: 'this_slot',
  rejections: [],
  ...over,
})

const releases = () => [
  release('a', 'Paddington.2014.1080p.BluRay.x264-GRP', { score: 1750, custom_formats: [{ name: 'Remux Tier 1', points: 1750 }] }),
  release('b', 'Paddington.2014.FRENCH.1080p.BluRay.x264-GRP', {
    score: 20,
    languages: ['French'],
    rejections: [{ code: 'language', message: 'Not in the language the Profile requires', overridable: true }],
  }),
  release('c', 'Paddington.2014.2160p.WEB-DL.x265-GRP', {
    quality: 'WEBDL-2160p',
    fits: 'other_slot',
    rejections: [{ code: 'other_slot', message: 'Fits another Slot', overridable: false }],
  }),
  release('d', 'Paddington.2014.1080p.BluRay.x264-BAD', {
    rejections: [{ code: 'blocklisted', message: 'On the Blocklist', overridable: false }],
  }),
]

type Posted = { path: string; body: unknown }

function fakeSearch(items: Release[], opts: { grabStatus?: number } = {}) {
  const state = { searches: 0, grabs: [] as Posted[], items }
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  server.use(
    http.post('/versions/{id}/releases', ({ response }) => {
      state.searches++
      return response(200).json({ items: state.items, indexer_errors: [] })
    }),
    http.post('/grabs', async ({ request, response }) => {
      const body = await request.clone().json()
      state.grabs.push({ path: '/grabs', body })
      if (opts.grabStatus === 409) {
        return response('default').json({ type: 'about:blank', title: 'conflict', status: 409, code: 'release_expired', detail: 'That Release is no longer in the search results; search again' }, { status: 409 })
      }
      return response(201).json({
        id: 7, title_id: 1, version_id: 11, release_name: 'x', indexer: 'Alpha', size: 1, published_at: '2026-10-16T12:00:00Z', score: 0,
        client_id: 'SABnzbd_nzo_1', state: 'sent', overridden: false, is_upgrade: false, created_at: '2026-10-17T12:00:00Z',
      })
    }),
  )
  return state
}

async function openManualSearch() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  const actions = await within(pane).findByRole('group', { name: 'Title actions' })
  await userEvent.click(within(actions).getByRole('button', { name: /manual search/i }))
  return screen.findByRole('table', { name: /releases/i })
}

const selected = () => screen.getByRole('row', { selected: true })

describe('manual search', () => {
  it('lists every Release with its Score, Custom Formats and rejections', async () => {
    fakeSearch(releases())
    const table = await openManualSearch()

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')
    expect(rows[0]).toHaveTextContent('1,750')
    expect(rows[0]).toHaveTextContent('Remux Tier 1')
    expect(rows[0]).toHaveTextContent('Bluray-1080p')
    expect(rows[0]).toHaveTextContent('Alpha')
    expect(rows[1]).toHaveTextContent('Not in the language the Profile requires')
    expect(rows[2]).toHaveTextContent('Fits another Slot')
    expect(rows[3]).toHaveTextContent('On the Blocklist')
  })

  it('labels Series Releases as a pack or by their episodes', async () => {
    fakeSearch([
      release('p', 'Show.S01.1080p.WEB-DL-GRP', { season: 1, pack: true, episodes: [] }),
      release('e', 'Show.S01E03E04.1080p.WEB-DL-GRP', { season: 1, pack: false, episodes: [3, 4] }),
    ])
    const table = await openManualSearch()

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Season 1 pack')
    expect(rows[1]).toHaveTextContent('S01E03-E04')
  })

  it('hides rejected Releases on request', async () => {
    fakeSearch(releases())
    const table = await openManualSearch()

    await userEvent.click(screen.getByRole('checkbox', { name: /hide rejected/i }))

    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
  })

  it('is driven by j and k, and Enter grabs the selected Release', async () => {
    const state = fakeSearch(releases())
    await openManualSearch()
    expect(selected()).toHaveTextContent('1080p.BluRay.x264-GRP')

    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('FRENCH')
    await userEvent.keyboard('k')
    expect(selected()).toHaveTextContent('1080p.BluRay.x264-GRP')

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText(/sent to the download client/i)).toBeInTheDocument()
    expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'a', override: false } }])
  })

  it('offers "Grab anyway" for an overridable rejection and sends the override', async () => {
    const state = fakeSearch(releases())
    await openManualSearch()
    await userEvent.keyboard('j')

    const grab = screen.getByRole('button', { name: 'Grab anyway' })
    expect(grab).toBeEnabled()
    await userEvent.click(grab)

    expect(await screen.findByText(/sent to the download client/i)).toBeInTheDocument()
    expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'b', override: true } }])
  })

  it('never offers to grab a Release for another Slot or a blocklisted one', async () => {
    const state = fakeSearch(releases())
    await openManualSearch()

    await userEvent.keyboard('jj') // the other-Slot Release
    expect(screen.getByRole('button', { name: 'Grab' })).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('j') // the blocklisted one
    expect(screen.getByRole('button', { name: 'Grab' })).toBeDisabled()
    await userEvent.keyboard('{Enter}')

    expect(state.grabs).toEqual([])
  })

  it('searches again when the Release has expired', async () => {
    const state = fakeSearch(releases(), { grabStatus: 409 })
    await openManualSearch()
    expect(state.searches).toBe(1)

    await userEvent.keyboard('{Enter}')

    expect(await screen.findByText(/no longer in the search results/i)).toBeInTheDocument()
    await screen.findByRole('table', { name: /releases/i })
    expect(state.searches).toBe(2)
  })

  it('goes back to the Title with Escape', async () => {
    fakeSearch(releases())
    await openManualSearch()

    await userEvent.keyboard('{Escape}')

    expect(await screen.findByRole('group', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /releases/i })).not.toBeInTheDocument()
  })

  it('says when an indexer could not answer', async () => {
    fakeSearch([])
    server.use(
      http.post('/versions/{id}/releases', ({ response }) =>
        response(200).json({ items: [], indexer_errors: [{ indexer_id: 1, indexer: 'Alpha', code: 'rate_limited', message: 'Request limit reached', retry_after: 90 }] }),
      ),
    )
    await openManualSearch()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Alpha: Request limit reached')
    expect(alert).toHaveTextContent('retry in 90 s')
  })
})

import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { serveDisplay } from '../test/serveDisplay'
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

function fakeSearch(items: Release[], opts: { grabStatus?: number; hold?: Promise<void> } = {}) {
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
      await opts.hold
      if (opts.grabStatus === 409) {
        return response('default').json(
          { type: 'about:blank', title: 'conflict', status: 409, code: 'release_expired', detail: 'That Release is no longer in the search results; search again' },
          { status: 409 },
        )
      }
      return response(201).json({
        id: 7,
        title_id: 1,
        version_id: 11,
        release_name: 'x',
        indexer: 'Alpha',
        size: 1,
        published_at: '2026-10-16T12:00:00Z',
        score: 0,
        client_id: 'SABnzbd_nzo_1',
        state: 'sent',
        overridden: false,
        is_upgrade: false,
        created_at: '2026-10-17T12:00:00Z',
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
    fakeSearch([release('p', 'Show.S01.1080p.WEB-DL-GRP', { season: 1, pack: true, episodes: [] }), release('e', 'Show.S01E03E04.1080p.WEB-DL-GRP', { season: 1, pack: false, episodes: [3, 4] })])
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

    expect(await screen.findByRole('listitem', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /releases/i })).not.toBeInTheDocument()
  })

  it('keeps the Releases table, busy and with its columns, while every indexer is searched', async () => {
    fakeSearch(releases())
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post('/versions/{id}/releases', async ({ response }) => {
        await gate
        return response(200).json({ items: releases(), indexer_errors: [] })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })
    const actions = await within(pane).findByRole('group', { name: 'Title actions' })
    await userEvent.click(within(actions).getByRole('button', { name: /manual search/i }))

    const table = await screen.findByRole('table', { name: /releases/i })
    expect(table).toHaveAttribute('aria-busy', 'true')
    expect(within(table).getByRole('columnheader', { name: /release/i })).toBeInTheDocument()

    release()
    await screen.findByRole('row', { name: /Paddington.2014.1080p.BluRay.x264-GRP/ })
    expect(screen.getByRole('table', { name: /releases/i })).not.toHaveAttribute('aria-busy', 'true')
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

  describe('episode titles', () => {
    it('shows the Primary Language title next to the episode badge, TBA for an unlisted episode and none for a pack', async () => {
      fakeSearch([
        release('p', 'Show.S01.1080p.WEB-DL-GRP', { season: 1, pack: true, episodes: [] }),
        release('e', 'Show.S01E03.1080p.WEB-DL-GRP', { season: 1, pack: false, episodes: [3], episode_titles: ['Der Einstieg'] }),
        release('t', 'Show.S01E09.1080p.WEB-DL-GRP', { season: 1, pack: false, episodes: [9], episode_titles: [''] }),
        release('m', 'Show.S01E01E02E03E04.1080p.WEB-DL-GRP', { season: 1, pack: false, episodes: [1, 2, 3, 4], episode_titles: ['A', 'B', 'C', 'D'] }),
      ])
      const table = await openManualSearch()

      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows[0]).toHaveTextContent('Season 1 pack')
      expect(rows[0]).not.toHaveTextContent('·')
      expect(rows[1]).toHaveTextContent('S01E03· Der Einstieg')
      expect(rows[2]).toHaveTextContent('S01E09· TBA')
      expect(within(rows[2]).getByTitle('TBA')).toBeInTheDocument()
      expect(rows[3]).toHaveTextContent('S01E01-E04· A / B / +2 more')
      expect(within(rows[3]).getByTitle('A · B · C · D')).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    const named = (id: string, over: Partial<Release>) => release(id, `Rel.${id}`, over)
    const sortable = () => [
      named('mid', {
        score: 500,
        quality: 'Bluray-1080p',
        languages: ['German'],
        size: 5 * 1024 ** 3,
        published_at: '2026-10-10T12:00:00Z',
        indexer: 'Beta',
        custom_formats: [
          { name: 'HDR', points: 100 },
          { name: 'Atmos', points: 50 },
        ],
      }),
      named('big', {
        score: 900,
        quality: 'Remux-1080p',
        languages: ['English'],
        size: 30 * 1024 ** 3,
        published_at: '2026-10-15T12:00:00Z',
        indexer: 'Alpha',
        custom_formats: [{ name: 'Atmos', points: 50 }],
      }),
      named('old', {
        score: 100,
        quality: 'HDTV-720p',
        languages: ['French'],
        size: 1 * 1024 ** 3,
        published_at: '2026-09-01T12:00:00Z',
        indexer: 'Gamma',
        custom_formats: [
          { name: 'HDR', points: 100 },
          { name: 'DV', points: 200 },
        ],
      }),
      named('bad', { score: 9999, size: 99 * 1024 ** 3, rejections: [{ code: 'language', message: 'Not in the language the Profile requires', overridable: true }] }),
    ]
    const order = (table: HTMLElement) =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => /Rel\.(big|mid|old|bad)/.exec(r.textContent ?? '')?.[1])
    const header = (name: string) => screen.getByRole('button', { name })

    it('is best first by default, with the Score header marked', async () => {
      fakeSearch(sortable())
      const table = await openManualSearch()

      expect(order(table)).toEqual(['big', 'mid', 'old', 'bad'])
      expect(screen.getByRole('columnheader', { name: 'Score' })).toHaveAttribute('aria-sort', 'descending')
      expect(screen.getByRole('columnheader', { name: 'Size' })).toHaveAttribute('aria-sort', 'none')
    })

    it.each([
      ['Score', ['old', 'mid', 'big', 'bad'], ['big', 'mid', 'old', 'bad']],
      ['Release', ['big', 'mid', 'old', 'bad'], ['old', 'mid', 'big', 'bad']],
      ['Quality', ['mid', 'old', 'big', 'bad'], ['big', 'old', 'mid', 'bad']],
      ['Languages', ['big', 'old', 'mid', 'bad'], ['mid', 'old', 'big', 'bad']],
      ['Custom formats', ['big', 'mid', 'old', 'bad'], ['old', 'mid', 'big', 'bad']],
      ['Size', ['old', 'mid', 'big', 'bad'], ['big', 'mid', 'old', 'bad']],
      ['Age', ['big', 'mid', 'old', 'bad'], ['old', 'mid', 'big', 'bad']],
      ['Indexer', ['big', 'mid', 'old', 'bad'], ['old', 'mid', 'big', 'bad']],
    ] as const)('sorts by %s, ascending then descending, with the rejected Release always last', async (column, asc, desc) => {
      fakeSearch(sortable())
      const table = await openManualSearch()

      await userEvent.click(header(column))
      expect(screen.getByRole('columnheader', { name: column })).toHaveAttribute('aria-sort', 'ascending')
      expect(order(table)).toEqual(asc)

      await userEvent.click(header(column))
      expect(screen.getByRole('columnheader', { name: column })).toHaveAttribute('aria-sort', 'descending')
      expect(order(table)).toEqual(desc)
    })

    it('brings best first back with one click', async () => {
      fakeSearch(sortable())
      const table = await openManualSearch()
      await userEvent.click(header('Size'))

      await userEvent.click(screen.getByRole('button', { name: 'Best first' }))

      expect(order(table)).toEqual(['big', 'mid', 'old', 'bad'])
      expect(screen.queryByRole('button', { name: 'Best first' })).not.toBeInTheDocument()
    })

    it('pins the Releases with a Custom Format to the top, unpins on a second click, and keeps rejected ones last', async () => {
      const items = sortable()
      items[3] = { ...items[3], custom_formats: [{ name: 'HDR', points: 100 }] }
      fakeSearch(items)
      const table = await openManualSearch()
      const chip = () => within(table).getAllByRole('button', { name: 'HDR' })[0]

      await userEvent.click(chip())
      expect(order(table)).toEqual(['mid', 'old', 'big', 'bad'])
      expect(chip()).toHaveAttribute('aria-pressed', 'true')

      await userEvent.click(chip())
      expect(order(table)).toEqual(['big', 'mid', 'old', 'bad'])
      expect(chip()).toHaveAttribute('aria-pressed', 'false')
    })

    it('remembers the sort and the pinned Custom Format for the next manual search', async () => {
      fakeSearch(sortable())
      let table = await openManualSearch()
      await userEvent.click(header('Size'))
      await userEvent.click(within(table).getAllByRole('button', { name: 'Atmos' })[0])
      await userEvent.keyboard('{Escape}')
      await screen.findByRole('listitem', { name: 'Standard' })

      const pane = await screen.findByRole('region', { name: /paddington/i })
      const actions = await within(pane).findByRole('group', { name: 'Title actions' })
      await userEvent.click(within(actions).getByRole('button', { name: /manual search/i }))
      table = await screen.findByRole('table', { name: /releases/i })

      expect(screen.getByRole('columnheader', { name: 'Size' })).toHaveAttribute('aria-sort', 'ascending')
      expect(order(table)).toEqual(['mid', 'big', 'old', 'bad'])
    })

    it('makes j, k and Enter follow the sorted order', async () => {
      const state = fakeSearch(sortable())
      await openManualSearch()
      await userEvent.click(header('Size')) // old, mid, big, bad

      expect(selected()).toHaveTextContent('Rel.old')
      await userEvent.keyboard('j')
      expect(selected()).toHaveTextContent('Rel.mid')
      await userEvent.keyboard('{Enter}')

      expect(await screen.findByText(/sent to the download client/i)).toBeInTheDocument()
      expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'mid', override: false } }])
    })

    it('sorts from the keyboard: the headers are buttons', async () => {
      fakeSearch(sortable())
      const table = await openManualSearch()

      header('Indexer').focus()
      await userEvent.keyboard('{Enter}')

      expect(order(table)).toEqual(['big', 'mid', 'old', 'bad'])
      expect(screen.getByRole('columnheader', { name: 'Indexer' })).toHaveAttribute('aria-sort', 'ascending')
    })
  })

  describe('feedback on a Grab', () => {
    const grabbed = (name: string) =>
      within(screen.getByRole('table', { name: /releases/i }))
        .getAllByRole('row')
        .find((r) => r.textContent?.includes(name))!

    it('shows "Grabbing…" with a spinner from the trigger until the request settles', async () => {
      let release!: () => void
      const state = fakeSearch(releases(), { hold: new Promise<void>((r) => (release = r)) })
      await openManualSearch()

      await userEvent.keyboard('{Enter}')
      const button = await screen.findByRole('button', { name: /grabbing/i })
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent('Grabbing…')
      await userEvent.keyboard('{Enter}') // a second trigger does nothing
      expect(state.grabs).toHaveLength(1)

      release()
      expect(await screen.findByRole('button', { name: 'Grab' })).toBeEnabled()
    })

    it('confirms the Release in a live region with a link to Activity, and keeps it when the selection moves', async () => {
      fakeSearch(releases())
      await openManualSearch()
      await userEvent.keyboard('{Enter}')

      const confirmation = (await screen.findByText(/sent to the download client/i)).closest('[aria-live]') as HTMLElement
      expect(confirmation).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')

      await userEvent.keyboard('j')
      expect(screen.getByText(/sent to the download client/i)).toBeInTheDocument()
      expect(confirmation).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')

      await userEvent.click(within(confirmation).getByRole('button', { name: 'View in Activity' }))
      expect(location.pathname).toBe('/activity')
    })

    it('marks the grabbed Release, through selection changes and a sort change', async () => {
      fakeSearch(releases())
      await openManualSearch()
      expect(screen.queryByText('Grabbed')).not.toBeInTheDocument()
      await userEvent.keyboard('{Enter}')
      await screen.findByText(/sent to the download client/i)
      expect(within(grabbed('Paddington.2014.1080p.BluRay.x264-GRP')).getByText('Grabbed')).toBeInTheDocument()

      await userEvent.keyboard('jj')
      await userEvent.click(screen.getByRole('columnheader', { name: /^size/i }))
      expect(screen.getAllByText('Grabbed')).toHaveLength(1)
      expect(within(grabbed('Paddington.2014.1080p.BluRay.x264-GRP')).getByText('Grabbed')).toBeInTheDocument()
    })

    it('shows the error and marks nothing when the Grab fails', async () => {
      fakeSearch(releases(), { grabStatus: 409 })
      await openManualSearch()
      await userEvent.keyboard('{Enter}')

      expect(await screen.findByText(/no longer in the search results/i)).toBeInTheDocument()
      expect(screen.queryByText('Grabbed')).not.toBeInTheDocument()
      expect(screen.queryByText(/sent to the download client/i)).not.toBeInTheDocument()
    })
  })
})

describe('manual search on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    sessionStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  async function openPhoneSearch() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await within(await screen.findByRole('listbox', { name: /library/i })).findByRole('option', { name: /paddington/i }))
    const actions = await screen.findByRole('group', { name: 'Title actions' })
    await userEvent.click(within(actions).getByRole('button', { name: /manual search/i }))
    return screen.findByRole('list', { name: /releases/i })
  }

  it('stacks each Release: name and Score, then Quality, Size, Age and Indexer as Pills, and why it was rejected', async () => {
    fakeSearch(releases())
    const list = await openPhoneSearch()

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP')
    expect(rows[0]).toHaveTextContent('1,750')
    expect(rows[0]).toHaveTextContent('Bluray-1080p')
    expect(rows[0]).toHaveTextContent('8.0 GB')
    expect(rows[0]).toHaveTextContent('Alpha')
    expect(rows[0]).toHaveTextContent('Remux Tier 1')
    expect(rows[1]).toHaveTextContent('Not in the language the Profile requires')
    expect(rows[2]).toHaveTextContent('Fits another Slot')
    expect(rows[3]).toHaveTextContent('On the Blocklist')
  })

  it('puts Back on its own line above the title', async () => {
    fakeSearch(releases())
    await openPhoneSearch()

    const section = screen.getByRole('region', { name: 'Manual search' })
    expect(within(section).getByRole('button', { name: /paddington/i })).toBeInTheDocument()
    expect(within(section).getByText(/Profile .* · 4 Releases · best first/)).toBeInTheDocument()
  })

  it('names each sort in plain words', async () => {
    fakeSearch(releases())
    await openPhoneSearch()

    const options = within(screen.getByRole('combobox', { name: /sort/i })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'Best first',
      'Worst first',
      'Release A to Z',
      'Release Z to A',
      'Quality A to Z',
      'Quality Z to A',
      'Languages A to Z',
      'Languages Z to A',
      'Custom formats: fewest points first',
      'Custom formats: most points first',
      'Smallest first',
      'Largest first',
      'Newest first',
      'Oldest first',
      'Indexer A to Z',
      'Indexer Z to A',
    ])
  })

  it('hides rejected Releases', async () => {
    fakeSearch(releases())
    const list = await openPhoneSearch()

    await userEvent.click(screen.getByRole('checkbox', { name: /hide rejected/i }))

    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  })

  it('sorts with a Select, keeps rejected rows last, and remembers the sort', async () => {
    fakeSearch([
      release('small', 'Rel.small', { score: 500, size: 1 * 1024 ** 3 }),
      release('big', 'Rel.big', { score: 100, size: 20 * 1024 ** 3 }),
      release('bad', 'Rel.bad', { score: 9999, size: 0.5 * 1024 ** 3, rejections: [{ code: 'language', message: 'Nope', overridable: true }] }),
    ])
    const list = await openPhoneSearch()
    const names = () =>
      within(list)
        .getAllByRole('listitem')
        .map((r) => /Rel\.(small|big|bad)/.exec(r.textContent ?? '')?.[1])
    expect(names()).toEqual(['small', 'big', 'bad'])

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'size:desc')

    expect(names()).toEqual(['big', 'small', 'bad'])
    expect(JSON.parse(sessionStorage.getItem('kestrel.manualSearchView') ?? 'null').sort).toEqual({ key: 'size', dir: 'desc' })
    expect(screen.getByText(/Profile .* · 3 Releases · largest first/)).toBeInTheDocument()
  })

  it("starts a new session on the household's default sort, which the Select shows, and a pick still wins", async () => {
    serveDisplay({ manual_search_sort: 'size_desc' })
    fakeSearch([release('small', 'Rel.small', { score: 500, size: 1 * 1024 ** 3 }), release('big', 'Rel.big', { score: 100, size: 20 * 1024 ** 3 })])
    const list = await openPhoneSearch()
    const names = () =>
      within(list)
        .getAllByRole('listitem')
        .map((r) => /Rel\.(small|big)/.exec(r.textContent ?? '')?.[1])
    await waitFor(() => expect(screen.getByRole('combobox', { name: /sort/i })).toHaveValue('size:desc'))
    expect(names()).toEqual(['big', 'small'])
    expect(screen.getByText(/Profile .* · 2 Releases · largest first/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'score:desc')
    expect(names()).toEqual(['small', 'big'])
    expect(screen.getByText(/best first/)).toBeInTheDocument()
  })

  it('grabs the selected Release from the bottom bar', async () => {
    const state = fakeSearch(releases())
    const list = await openPhoneSearch()
    await userEvent.click(within(list).getByText('Paddington.2014.FRENCH.1080p.BluRay.x264-GRP'))

    const bar = screen.getByRole('contentinfo')
    expect(bar).toHaveTextContent('Paddington.2014.FRENCH.1080p.BluRay.x264-GRP')
    await userEvent.click(within(bar).getByRole('button', { name: 'Grab anyway' }))

    expect(await screen.findByText(/sent to the download client/i)).toBeInTheDocument()
    expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'b', override: true } }])
  })

  it("selects a Release when its row's padding is tapped, not only its content", async () => {
    fakeSearch(releases())
    const list = await openPhoneSearch()
    const row = within(list).getAllByRole('listitem')[1]

    await userEvent.click(row)

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Paddington.2014.FRENCH.1080p.BluRay.x264-GRP')
  })

  it('marks the grabbed Release on its stacked row', async () => {
    fakeSearch(releases())
    const list = await openPhoneSearch()
    await userEvent.click(within(list).getByText('Paddington.2014.FRENCH.1080p.BluRay.x264-GRP'))
    await userEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Grab anyway' }))

    await screen.findByText(/sent to the download client/i)
    const [row] = within(list).getAllByText('Grabbed')
    expect(row.closest('li')).toHaveTextContent('FRENCH')
  })
})

describe('manual search default sort', () => {
  beforeEach(() => sessionStorage.clear())

  it("starts on the household's default column and direction", async () => {
    serveDisplay({ manual_search_sort: 'age_asc' })
    fakeSearch(releases())
    await openManualSearch()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Age' })).toHaveAttribute('aria-sort', 'ascending'))
    expect(screen.getByRole('columnheader', { name: 'Score' })).toHaveAttribute('aria-sort', 'none')
  })

  it('keeps a sort picked in the session over the default, for the next search of the session', async () => {
    serveDisplay({ manual_search_sort: 'age_asc' })
    fakeSearch(releases())
    await openManualSearch()
    await userEvent.click(screen.getByRole('button', { name: 'Size' }))
    expect(screen.getByRole('columnheader', { name: 'Size' })).toHaveAttribute('aria-sort', 'ascending')
    cleanup()

    await openManualSearch()
    expect(screen.getByRole('columnheader', { name: 'Size' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Age' })).toHaveAttribute('aria-sort', 'none')
  })
})

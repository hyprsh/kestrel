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
import { chooseSearchItem } from '../test/titleHeader'
import { findToast, toastRegion } from '../test/toasts'
import { fakeQueue, queueItem } from '../test/queue'
import { releaseList } from '../test/grabs'

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

function fakeSearch(items: Release[], opts: { grabStatus?: number; hold?: Promise<void>; wanted?: number } = {}) {
  const state = { searches: 0, grabs: [] as Posted[], items }
  fakeLibrary([row(1, 'Paddington', 'Paddington')])
  server.use(
    http.post('/versions/{id}/releases', ({ response }) => {
      state.searches++
      return response(200).json(releaseList({ items: state.items, wanted: opts.wanted ?? 0 }))
    }),
    http.post('/grabs', async ({ request, response }) => {
      const body = await request.clone().json()
      state.grabs.push({ path: '/grabs', body })
      await opts.hold
      if (opts.grabStatus === 502 && state.grabs.length === 1) {
        return response('default').json(
          { type: 'about:blank', title: 'bad gateway', status: 502, code: 'upstream_unavailable', detail: 'SABnzbd refused it: the NZB is no longer on the indexer.' },
          { status: 502 },
        )
      }
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

/** Opens manual search on the Title page of Paddington; `phone` opens it from the list. */
async function openManualSearch() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  await chooseSearchItem(pane, /manual search/i)
  return screen.findByRole('table', { name: /releases/i })
}

const selected = () => screen.getByRole('row', { selected: true })
const bestFit = () => screen.getByRole('region', { name: 'Best fit' })
const rowOf = (name: RegExp) => screen.getByRole('row', { name })

const gb = 1024 ** 3
const seriesReleases = () => [
  release('pack', 'Show.S05.2160p.WEB-DL-NTb', {
    score: 2350,
    quality: 'WEBDL-2160p',
    video_codec: 'H.265',
    hdr: 'HDR10',
    audio_codec: 'DDP',
    audio_channels: '5.1',
    size: 38 * gb,
    season: 5,
    pack: true,
    episodes: [],
    group: 'NTb',
    grabs: 412,
    info_url: 'https://alpha.example/details/1',
    custom_formats: [
      { name: 'WEB Tier 01', points: 1700 },
      { name: 'x265 (HD)', points: -150 },
    ],
    covers: [
      { season: 5, episode: 1, state: 'filled', file_score: 2100 },
      { season: 5, episode: 2, state: 'filled', file_score: 2100 },
      { season: 5, episode: 5, state: 'wanted' },
      { season: 5, episode: 6, state: 'wanted' },
    ],
  }),
  release('e5', 'Show.S05E05.2160p.WEB-DL-NTb', {
    score: 2050,
    video_codec: 'H.265',
    hdr: 'HDR10',
    audio_codec: 'DDP',
    audio_channels: '5.1',
    season: 5,
    episodes: [5],
    episode_titles: ['Dead Freight'],
    group: 'NTb',
    grabs: 412,
    info_url: 'https://alpha.example/details/2',
    covers: [{ season: 5, episode: 5, state: 'wanted' }],
    custom_formats: [
      { name: 'WEB Tier 01', points: 1700 },
      { name: 'HDR', points: 500 },
      { name: 'x265 (HD)', points: -150 },
    ],
  }),
  release('e6', 'Show.S05E06.2160p.WEB-DL-NTb', { score: 1850, season: 5, episodes: [6], covers: [{ season: 5, episode: 6, state: 'wanted' }] }),
  release('de', 'Show.S05.GERMAN.2160p.WEB-GRP', {
    score: 1800,
    languages: ['German'],
    season: 5,
    pack: true,
    rejections: [{ code: 'language', message: 'Not in the language the Profile requires', overridable: true }],
  }),
  release('de2', 'Show.S04.GERMAN.2160p.WEB-GRP', {
    score: 1700,
    languages: ['German'],
    season: 4,
    pack: true,
    rejections: [{ code: 'language', message: 'Not in the language the Profile requires', overridable: true }],
  }),
  release('bl', 'Show.S05E07.2160p.WEB-BAD', { score: 100, season: 5, episodes: [7], rejections: [{ code: 'blocklisted', message: 'On the Blocklist', overridable: false }] }),
]

describe('manual search', () => {
  beforeEach(() => sessionStorage.clear())

  it('shows the Best fit with its why, facts, Custom Formats, Score and one Grab', async () => {
    fakeSearch(seriesReleases(), { wanted: 4 })
    await openManualSearch()

    const card = await screen.findByRole('region', { name: 'Best fit' })
    expect(card).toHaveTextContent('Best fit')
    expect(card).toHaveTextContent('Season pack · covers 2 of 4 Wanted · replaces 2 files')
    expect(card).toHaveTextContent('Show.S05.2160p.WEB-DL-NTb')
    for (const fact of ['WEB-DL 2160p', 'HDR10', 'DDP 5.1', 'English', '38.0 GB', 'Alpha']) expect(within(card).getByText(fact)).toBeInTheDocument()
    expect(card).toHaveTextContent('WEB Tier 01 +1,700')
    expect(card).toHaveTextContent('x265 (HD) −150')
    expect(card).toHaveTextContent('2,350')
    expect(within(card).getAllByRole('button')).toHaveLength(1)
  })

  it('has no Best fit card when nothing fits', async () => {
    fakeSearch(releases().slice(1))
    await openManualSearch()
    await screen.findByText('No Release fits the Profile.')
    expect(screen.queryByRole('region', { name: 'Best fit' })).not.toBeInTheDocument()
  })

  it('puts the status in a line under the heading: indexers, releases, how many fit, and a failed indexer with a retry', async () => {
    const state = fakeSearch(releases())
    server.use(
      http.post('/versions/{id}/releases', ({ response }) => {
        state.searches++
        return response(200).json(
          releaseList({
            items: releases(),
            indexers_searched: 4,
            wanted: 1,
            indexer_errors: [{ indexer_id: 1, indexer: 'Alpha', code: 'rate_limited', message: 'Request limit reached', retry_after: 90 }],
          }),
        )
      }),
    )
    await openManualSearch()

    expect(screen.getByRole('heading', { name: 'Manual search' })).toBeInTheDocument()
    const line = await screen.findByText(/4 indexers searched/)
    expect(line).toHaveTextContent('0 s ago · 4 releases · 1 fit the Profile · Alpha: Request limit reached (retry in 90 s), retry')
    expect(screen.getByText('Standard · HD')).toBeInTheDocument()
    expect(screen.getByText('1 Wanted')).toBeInTheDocument()

    await userEvent.click(within(line).getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(state.searches).toBe(2))
  })

  it('searches again from the refresh button', async () => {
    const state = fakeSearch(releases())
    await openManualSearch()
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }))
    await waitFor(() => expect(state.searches).toBe(2))
  })

  it('filters by Fits, Season packs, Episodes and Rejected for a Series, and only Fits and Rejected for a Movie', async () => {
    fakeSearch(releases())
    await openManualSearch()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Fits 1', 'Rejected 3'])
    cleanup()

    fakeSearch(seriesReleases())
    const table = await openManualSearch()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Fits 3', 'Season packs 1', 'Episodes 2', 'Rejected 3'])
    // The Best fit sits on its card, not in the list.
    expect(within(table).queryByText('Show.S05.2160p.WEB-DL-NTb')).not.toBeInTheDocument()
    expect(within(table).getByText('Show.S05E05.2160p.WEB-DL-NTb')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /episodes/i }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2)
    await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(3)
    expect(within(table).getAllByText('Not in the language the Profile requires')).toHaveLength(2)
  })

  it('shows a row as name, facts line, size and age, with episode titles', async () => {
    fakeSearch(seriesReleases())
    await openManualSearch()
    const row = rowOf(/Show.S05E05/)
    expect(row).toHaveTextContent('E05 · Dead Freight · BluRay 1080p · HDR10 · English · Alpha')
    expect(row).toHaveTextContent('8.0 GB')
    expect(row).toHaveTextContent('2,050')
  })

  it('folds the rejected Releases into one line grouped by why, and Show lists them', async () => {
    fakeSearch(seriesReleases())
    const table = await openManualSearch()

    const summary = within(table).getByRole('button', { name: /3 rejected/ })
    expect(summary).toHaveTextContent('3 rejected · 2 German only · 1 blocklisted')
    expect(within(table).queryByText('Show.S05.GERMAN.2160p.WEB-GRP')).not.toBeInTheDocument()

    await userEvent.click(summary)
    expect(within(table).getByText('Show.S05.GERMAN.2160p.WEB-GRP')).toBeInTheDocument()
    expect(within(table).getByText('Show.S05E07.2160p.WEB-BAD')).toBeInTheDocument()
    await userEvent.click(within(table).getByRole('button', { name: /3 rejected/ }))
    expect(within(table).queryByText('Show.S05.GERMAN.2160p.WEB-GRP')).not.toBeInTheDocument()
  })

  it('offers Show rejected when every Release is rejected', async () => {
    fakeSearch(releases().slice(1))
    const table = await openManualSearch()
    expect(screen.getByText('No Release fits the Profile.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show rejected' }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(3)
  })

  describe('an opened row', () => {
    it('opens in place with Enter or a click, one at a time, and says why it scores what it does', async () => {
      fakeSearch(seriesReleases(), { wanted: 4 })
      const table = await openManualSearch()

      await userEvent.keyboard('{Enter}')
      const detail = within(table).getByText('Why it scores 2,050').closest('tr') as HTMLElement
      expect(detail).toHaveTextContent('Covers')
      expect(detail).toHaveTextContent('S05E05 · Wanted')
      expect(detail).toHaveTextContent('QualityBluRay 1080p · H.265 · HDR10')
      expect(detail).toHaveTextContent('AudioDDP 5.1 · English')
      expect(detail).toHaveTextContent('Size')
      expect(detail).toHaveTextContent('Published')
      expect(detail).toHaveTextContent('Fits HD. The best fit scores 2,350.')
      expect(within(detail).getByRole('button', { name: 'Grab' })).toBeInTheDocument()
      expect(within(detail).getByRole('button', { name: 'Blocklist' })).toBeInTheDocument()
      expect(within(detail).getByRole('button', { name: 'Copy Link' })).toBeEnabled()

      await userEvent.click(within(table).getByText('Show.S05E06.2160p.WEB-DL-NTb'))
      expect(within(table).queryByText('Why it scores 2,050')).not.toBeInTheDocument()
      expect(within(table).getByText('Why it scores 1,850')).toBeInTheDocument()
      await userEvent.keyboard('{Enter}')
      expect(within(table).queryByText(/Why it scores/)).not.toBeInTheDocument()
    })

    it('says the size is within the Profile’s limit, and what a Release over it was rejected for', async () => {
      const limit = { per_episode: true, min: 1 * gb, max: 10 * gb }
      const items = [
        release('top', 'Show.S05E04.1080p.WEB-DL-TOP', { score: 500, season: 5, episodes: [4] }),
        release('ep', 'Show.S05E05.1080p.WEB-DL-NTb', { score: 100, size: 6.3 * gb, season: 5, episodes: [5], size_limit: limit }),
        release('big', 'Show.S05E06.1080p.WEB-DL-FAT', {
          score: 90,
          size: 14 * gb,
          season: 5,
          episodes: [6],
          size_limit: limit,
          rejections: [{ code: 'size', message: 'Over the size limit', overridable: true }],
        }),
        release('tiny', 'Show.S05E07.1080p.WEB-DL-TINY', {
          score: 80,
          size: 0.2 * gb,
          season: 5,
          episodes: [7],
          size_limit: limit,
          rejections: [{ code: 'size', message: 'Under the size limit', overridable: true }],
        }),
      ]
      fakeSearch(items)
      const table = await openManualSearch()
      await userEvent.click(within(table).getByText('Show.S05E05.1080p.WEB-DL-NTb'))
      expect(await screen.findByText('6.3 GB · within 1 – 10 GB per episode')).toBeInTheDocument()
      expect(within(table).getByRole('button', { name: /2 rejected/ })).toHaveTextContent('2 rejected · 1 over the size limit · 1 under the size limit')

      await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))
      await userEvent.click(within(table).getByText('Show.S05E06.1080p.WEB-DL-FAT'))
      const open = screen.getByText(/^Rejected: Over the size limit/)
      expect(open).toHaveTextContent('Its size is 14.0 GB, and the Profile takes 1 – 10 GB per episode. You can still grab it')
      expect(screen.getByRole('button', { name: 'Grab Anyway…' })).toBeInTheDocument()
    })

    it('lists each Custom Format with its points that add up to the Score, the group and the indexer grabs', async () => {
      fakeSearch(seriesReleases())
      await openManualSearch()
      await userEvent.keyboard('{Enter}')

      const why = screen.getByText('Why it scores 2,050').parentElement as HTMLElement
      expect(within(why).getByText('WEB Tier 01').nextSibling).toHaveTextContent('+1,700')
      expect(within(why).getByText('HDR').nextSibling).toHaveTextContent('+500')
      expect(within(why).getByText('x265 (HD)').nextSibling).toHaveTextContent('−150')
      expect(within(why).getByText('Score').nextSibling).toHaveTextContent('2,050')
      const detail = why.closest('tr') as HTMLElement
      expect(detail).toHaveTextContent('Alpha · 412 grabs')
      expect(detail).toHaveTextContent('NTb')
      expect(within(detail).getByRole('button', { name: 'Copy Link' })).toBeEnabled()
    })

    it('shows the rejections of a rejected row with Grab Anyway, and no Grab for one that can never be grabbed', async () => {
      fakeSearch(seriesReleases())
      const table = await openManualSearch()
      await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))

      await userEvent.click(within(table).getByText('Show.S05.GERMAN.2160p.WEB-GRP'))
      const open = screen.getByText(/^Rejected: Not in the language/)
      expect(open).toHaveTextContent('You can still grab it')
      expect(screen.getByRole('button', { name: 'Grab Anyway…' })).toBeInTheDocument()

      await userEvent.click(within(table).getByText('Show.S05E07.2160p.WEB-BAD'))
      const blocked = screen.getByText(/^Rejected: On the Blocklist/)
      expect(blocked).toHaveTextContent('never grabs')
      expect(within(blocked.closest('tr') as HTMLElement).queryByRole('button', { name: /^Grab/ })).not.toBeInTheDocument()
    })

    it('blocklists a Release for the Version and moves it to the rejected ones', async () => {
      fakeSearch(seriesReleases())
      const posted: unknown[] = []
      server.use(
        http.post('/blocklist', async ({ request, response }) => {
          posted.push(await request.clone().json())
          return response(204).empty()
        }),
      )
      const table = await openManualSearch()
      await userEvent.keyboard('{Enter}')
      await userEvent.click(screen.getByRole('button', { name: 'Blocklist' }))

      await waitFor(() => expect(posted).toEqual([{ version_id: 11, release_id: 'e5' }]))
      await screen.findByRole('button', { name: /4 rejected/ })
      expect(within(table).queryByText('Show.S05E05.2160p.WEB-DL-NTb')).not.toBeInTheDocument()
    })
  })

  describe('grabbing', () => {
    it('sends a Release that fits and replaces nothing at once, without a dialog, and the row follows the download', async () => {
      const state = fakeSearch(seriesReleases(), { wanted: 2 })
      fakeQueue([queueItem({ grab_id: 7, bytes_total: 100, bytes_left: 88, eta: 1320 })])
      const table = await openManualSearch()
      expect(screen.getByText('2 Wanted')).toBeInTheDocument()

      await userEvent.click(within(table).getByRole('button', { name: /^Grab Show.S05E05/ }))

      expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'e5', override: false } }])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const row = await screen.findByRole('row', { name: /Show.S05E05/ })
      expect(await within(row).findByText('Downloading · 12% · 22 min')).toBeInTheDocument()
      expect(within(row).getByRole('progressbar')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'View in Activity' })).toBeInTheDocument()
      expect(await screen.findByText('1 downloading')).toBeInTheDocument()
      expect(screen.getByText('1 Wanted')).toBeInTheDocument()
      expect(await findToast('Grabbed for Standard · S05E05')).toBeInTheDocument()
      expect(within(await toastRegion()).getByRole('button', { name: 'Back to Paddington' })).toBeInTheDocument()
      // The other rows stay grabbable.
      expect(within(table).getByRole('button', { name: /^Grab Show.S05E06/ })).toBeEnabled()
    })

    it('grabs the selected Release with g', async () => {
      const state = fakeSearch(seriesReleases())
      fakeQueue([])
      await openManualSearch()
      await userEvent.keyboard('j')
      await userEvent.keyboard('g')
      await waitFor(() => expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'e6', override: false } }]))
    })

    it('asks first when the pack would replace files, and sends it on Grab and Replace', async () => {
      const state = fakeSearch(seriesReleases(), { wanted: 4 })
      fakeQueue([])
      await openManualSearch()

      await userEvent.click(within(bestFit()).getByRole('button', { name: 'Grab' }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Replace 2 files?')
      expect(dialog).toHaveTextContent('S05E01 – E02')
      expect(dialog).toHaveTextContent('Score 2,100')
      expect(dialog).toHaveTextContent('Fills')
      expect(dialog).toHaveTextContent('+250 each')
      expect(dialog).toHaveTextContent('38.0 GB')
      expect(state.grabs).toEqual([])

      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(state.grabs).toEqual([])

      await userEvent.click(within(bestFit()).getByRole('button', { name: 'Grab' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Grab and Replace' }))
      await waitFor(() => expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'pack', override: false } }]))
      expect(await within(bestFit()).findByRole('button', { name: 'View in Activity' })).toBeInTheDocument()
    })

    it('asks before "Grab Anyway" on a rejected Release and sends the override', async () => {
      const state = fakeSearch(seriesReleases())
      fakeQueue([])
      const table = await openManualSearch()
      await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))

      await userEvent.click(within(table).getByRole('button', { name: /^Grab anyway Show.S05.GERMAN/ }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Grab anyway?')
      expect(dialog).toHaveTextContent('Not in the language the Profile requires')
      expect(state.grabs).toEqual([])

      await userEvent.click(within(dialog).getByRole('button', { name: 'Grab Anyway' }))
      await waitFor(() => expect(state.grabs).toEqual([{ path: '/grabs', body: { version_id: 11, release_id: 'de', override: true } }]))
    })

    it('never offers to grab a Release for another Slot or a blocklisted one', async () => {
      const state = fakeSearch(releases())
      const table = await openManualSearch()
      await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))

      expect(within(table).getByRole('button', { name: /^Grab Paddington.2014.2160p/ })).toBeDisabled()
      expect(within(table).getByRole('button', { name: /^Grab Paddington.2014.1080p.BluRay.x264-BAD/ })).toBeDisabled()
      expect(state.grabs).toEqual([])
    })

    it('tints a failed grab red with the reason, and offers Retry and Grab Next Best', async () => {
      const state = fakeSearch(seriesReleases(), { grabStatus: 502 })
      const table = await openManualSearch()

      await userEvent.click(within(table).getByRole('button', { name: /^Grab Show.S05E05/ }))

      const row = await screen.findByRole('row', { name: /Show.S05E05/ })
      expect(await within(row).findByText('SABnzbd refused it: the NZB is no longer on the indexer.')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      await userEvent.click(within(row).getByRole('button', { name: 'Grab Next Best (2,350)' }))
      // The next best is the pack, which replaces two files: it asks first.
      expect(await screen.findByRole('dialog')).toHaveTextContent('Replace 2 files?')
      expect(state.grabs).toHaveLength(1)
    })

    it('searches again when the Release has expired', async () => {
      const state = fakeSearch(releases(), { grabStatus: 409 })
      await openManualSearch()
      expect(state.searches).toBe(1)

      await userEvent.click(within(bestFit()).getByRole('button', { name: 'Grab' }))

      expect(await within(bestFit()).findByText(/no longer in the search results/i)).toBeInTheDocument()
      await waitFor(() => expect(state.searches).toBe(2))
    })
  })

  it('moves with j and k and goes back to the Title with Escape', async () => {
    fakeSearch(seriesReleases())
    await openManualSearch()
    expect(selected()).toHaveTextContent('E05')
    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('E06')
    await userEvent.keyboard('k')
    expect(selected()).toHaveTextContent('E05')
    expect(screen.getByText('j k move · ↵ open · g grab · esc back')).toBeInTheDocument()

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
        return response(200).json(releaseList({ items: releases() }))
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })
    await chooseSearchItem(pane, /manual search/i)

    const table = await screen.findByRole('table', { name: /releases/i })
    expect(table).toHaveAttribute('aria-busy', 'true')
    expect(within(table).getByRole('columnheader', { name: /release/i })).toBeInTheDocument()

    release()
    await screen.findByRole('region', { name: 'Best fit' })
    expect(screen.getByRole('table', { name: /releases/i })).not.toHaveAttribute('aria-busy', 'true')
  })

  describe('paging', () => {
    const many = () => Array.from({ length: 120 }, (_, i) => release(`r${i}`, `Paddington.${String(i).padStart(3, '0')}.1080p-GRP`, { score: 1000 - i }))

    it('pages 50 Releases at a time, keeps the page in the address bar and goes back to page 1 on a sort', async () => {
      fakeSearch(many())
      const table = await openManualSearch()
      // 119 on the list: the Best fit is on its card.
      expect(within(table).getAllByRole('row').slice(1)).toHaveLength(50)
      expect(screen.getByText('1–50 of 119')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Next Page' }))
      expect(location.search).toContain('page=2')
      await userEvent.click(screen.getByRole('button', { name: 'Next Page' }))
      expect(within(table).getAllByRole('row').slice(1)).toHaveLength(19)

      await userEvent.click(screen.getByRole('button', { name: /^Sort releases/ }))
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Smallest first' }))
      expect(location.search).not.toContain('page=')
      expect(location.search).toContain('sort=size%3Aasc')
      expect(within(table).getAllByRole('row').slice(1)).toHaveLength(50)
    })
  })

  describe('sorting', () => {
    const sized = () => [
      release('a', 'Paddington.A.1080p-GRP', { score: 900, size: 9 * gb }),
      release('b', 'Paddington.B.1080p-GRP', { score: 800, size: 2 * gb }),
      release('c', 'Paddington.C.1080p-GRP', { score: 700, size: 5 * gb }),
      release('d', 'Paddington.D.1080p-GRP', { score: 100, rejections: [{ code: 'language', message: 'Not in the language the Profile requires', overridable: true }] }),
    ]
    const names = (table: HTMLElement) =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent ?? '')

    it('is best first by default and sorts from the Best first menu, keeping the choice for the next search', async () => {
      fakeSearch(sized())
      const table = await openManualSearch()
      expect(screen.getByRole('button', { name: 'Sort releases: Best first' })).toBeInTheDocument()
      expect(names(table)[0]).toContain('Paddington.B')

      await userEvent.click(screen.getByRole('button', { name: 'Sort releases: Best first' }))
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Smallest first' }))
      expect(names(table)[0]).toContain('Paddington.B')
      await userEvent.click(screen.getByRole('button', { name: 'Sort releases: Smallest first' }))
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Largest first' }))
      expect(names(table)[0]).toContain('Paddington.C')

      cleanup()
      fakeSearch(sized())
      await openManualSearch()
      expect(screen.getByRole('button', { name: 'Sort releases: Largest first' })).toBeInTheDocument()
    })

    it("starts on the household's default sort", async () => {
      fakeSearch(sized())
      serveDisplay({ manual_search_sort: 'size_asc' })
      await openManualSearch()
      expect(screen.getByRole('button', { name: 'Sort releases: Smallest first' })).toBeInTheDocument()
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
    await chooseSearchItem(document.body, /manual search/i)
    return screen.findByRole('list', { name: /releases/i })
  }

  it('has a header with back, title and options, the Best fit with a full-width Grab, filter chips and a Grab button per row', async () => {
    const state = fakeSearch(seriesReleases())
    fakeQueue([])
    const list = await openPhoneSearch()

    expect(screen.getByRole('heading', { name: 'Manual search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Paddington' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manual search options' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Fits 3', 'Packs 1', 'Episodes 2', 'Rejected 3'])
    expect(within(await screen.findByRole('region', { name: 'Best fit' })).getByRole('button', { name: 'Grab' })).toBeInTheDocument()

    await userEvent.click(within(list).getByRole('button', { name: /^Grab Show.S05E06/ }))
    await waitFor(() => expect(state.grabs).toHaveLength(1))
  })

  it('opens a row when it is tapped, with its score breakdown', async () => {
    fakeSearch(seriesReleases())
    const list = await openPhoneSearch()
    await userEvent.click(within(list).getByText('Show.S05E05.2160p.WEB-DL-NTb'))
    expect(await screen.findByText('Why it scores 2,050')).toBeInTheDocument()
  })

  it('sorts from the options menu', async () => {
    fakeSearch(seriesReleases())
    await openPhoneSearch()
    await userEvent.click(screen.getByRole('button', { name: 'Manual search options' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Smallest first' }))
    expect(location.search).toContain('sort=size%3Aasc')
  })
})

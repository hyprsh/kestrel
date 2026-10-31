import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { fakeRequests, request, requestSlot } from '../test/requests'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const section = () => screen.findByRole('region', { name: /^Recent requests/ })
const rows = async () => within(await section()).findAllByRole('listitem')

describe('Recent requests on the Overview', () => {
  it('shows the newest five, how many there are in all and a way to the rest', async () => {
    const queries = fakeRequests(
      Array.from({ length: 5 }, (_, i) => request({ id: 10 - i, title: `Movie ${i + 1}` })),
      12,
    )
    renderApp()

    const s = await screen.findByRole('region', { name: 'Recent requests · 12' })
    expect(
      within(s)
        .getAllByRole('listitem')
        .map((r) => r.textContent),
    ).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Movie ${n}`)))
    expect(queries[0].get('limit')).toBe('5')

    await userEvent.click(within(s).getByRole('button', { name: 'All requests →' }))
    expect(await screen.findByRole('combobox', { name: 'Filter Requests' })).toHaveValue('')
  })

  it('is a compact row: the poster, the Title and who asked, without the source, time or seasons', async () => {
    fakeRequests([request({ title: 'Severance', title_id: 7, has_poster: true, seasons: [1, 2], requester: { id: 'u-2', name: 'Ben' }, source: 'jellyseerr' }), request({ id: 2, title_id: null })])
    renderApp()

    const [series, movie] = await rows()
    expect(series).toHaveTextContent('Severance')
    expect(series).toHaveTextContent('Ben')
    expect(series).not.toHaveTextContent('Jellyseerr')
    expect(series).not.toHaveTextContent('Seasons')
    expect(series.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/titles/7/poster'))
    expect(movie).toHaveTextContent('Anna')
    expect(movie.querySelector('[data-poster]')).toBeInTheDocument()
  })

  it('badges each Slot with where it stands', async () => {
    fakeRequests([
      request({
        slots: [requestSlot({ status: 'queued', status_label: 'Not released yet' }), requestSlot({ slot: '4k', version_id: 12, status: 'completed', status_label: 'Completed' })],
      }),
      request({
        id: 2,
        slots: [requestSlot({ status: 'downloading', status_label: 'Downloading', download: { phase: 'downloading', bytes_total: 1000, bytes_left: 570, eta: 60 } })],
      }),
      request({ id: 3, slots: [requestSlot()] }),
    ])
    renderApp()

    const [unreleased, downloading, searching] = await rows()
    expect(unreleased).toHaveTextContent('Standard · Not released yet')
    expect(unreleased).toHaveTextContent('4K · Completed')
    expect(downloading).toHaveTextContent('Standard · Downloading 43%')
    expect(searching).toHaveTextContent('Standard · Searching')
  })

  it('follows a download from the live queue', async () => {
    fakeRequests([request({ slots: [requestSlot({ version_id: 11 })] })])
    fakeQueue([queueItem({ version_id: 11, bytes_total: 8000, bytes_left: 2000 })])
    renderApp()

    const [item] = await rows()
    expect(await within(item).findByText('Standard · Downloading 75%')).toBeInTheDocument()
  })

  it('names a rejected Request by what was asked for and says why in words', async () => {
    fakeRequests([
      request({
        id: 3,
        outcome: 'rejected',
        reject_reason: 'no_enabled_profile',
        title_id: null,
        title: 'Dune',
        slots: [requestSlot({ slot: '4k', version_id: null, status: 'failed', status_label: 'No enabled Profile' })],
      }),
      request({ id: 2, outcome: 'rejected', reject_reason: 'not_on_tvdb', title_id: null, title: 'Obscure Show', slots: [requestSlot({ version_id: null, status: 'failed' })] }),
      request({ id: 1, outcome: 'rejected', reject_reason: 'unknown_title', title_id: null, title: null, slots: [requestSlot({ version_id: null, status: 'failed' })] }),
    ])
    renderApp()

    const [profile, tvdb, unknown] = await rows()
    expect(profile).toHaveTextContent('Dune')
    expect(profile).toHaveTextContent('Rejected')
    expect(profile).toHaveTextContent('No Profile is enabled for the Slot')
    expect(tvdb).toHaveTextContent('Obscure Show')
    expect(tvdb).toHaveTextContent('TheTVDB does not list this Series')
    expect(unknown).toHaveTextContent('Unknown title')
    expect(unknown).toHaveTextContent('TMDB does not know this Title')
  })

  it('opens the Title from its row', async () => {
    fakeRequests([request({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const [item] = await rows()
    await userEvent.click(within(item).getAllByRole('button', { hidden: true })[0]) // the row's whole-row button

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('joins the Overview’s j/k list, and Enter opens the Title', async () => {
    fakeRequests([request({ title_id: 1 })])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()
    await rows()

    await userEvent.keyboard('j')
    expect(document.querySelector('[aria-current="true"]')).toHaveTextContent('Anna')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })
})

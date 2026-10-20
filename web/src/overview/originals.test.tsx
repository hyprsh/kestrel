import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Attention = components['schemas']['Attention']
type OriginalOffer = components['schemas']['OriginalOffer']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const movieOffer: OriginalOffer = {
  title_id: 1,
  title: 'Paddington',
  version_id: 11,
  slot: 'standard',
  profile: 'hd-primary',
  release: 'Paddington.2014.1080p.BluRay.x264-GRP',
  score: 50,
  found_at: '2026-10-18T09:30:00Z',
  dismissed: false,
  releases: [
    { name: 'Paddington.2014.1080p.BluRay.x264-GRP', indexer: 'Alpha', score: 50, size: 8 << 20, published_at: '2026-10-18T08:00:00Z', season: null, pack: false, episodes: [] },
  ],
}

const seriesOffer: OriginalOffer = {
  ...movieOffer,
  title_id: 2,
  title: 'Night Show',
  version_id: 21,
  release: 'Night.Show.S01.1080p.WEB-DL.H264-GRP',
  releases: [
    { name: 'Night.Show.S01.1080p.WEB-DL.H264-GRP', indexer: 'Alpha', score: 50, size: 1, published_at: '2026-10-18T08:00:00Z', season: 1, pack: true, episodes: [1, 2] },
    { name: 'Night.Show.S02E01.1080p.WEB-DL.H264-GRP', indexer: 'Alpha', score: 40, size: 1, published_at: '2026-10-18T08:00:00Z', season: 2, pack: false, episodes: [1] },
  ],
}

/** Serves /attention with the offers and records the actions taken on them. */
function fakeOffers(items: OriginalOffer[]) {
  const sent: string[] = []
  fakeLibrary([]) // serves /profiles with their names
  const originals: Attention['originals'] = { count: items.length, items }
  server.use(
    http.get('/attention', ({ response }) => response(200).json({ count: 0, severity: null, rows: [], long_missing: { count: 0, items: [] }, originals })),
    http.post('/versions/{id}/original-offer/accept', ({ params, response }) => {
      sent.push(`accept ${params.id}`)
      return response(201).json({ grabs: [], failed: 0 })
    }),
    http.post('/versions/{id}/original-offer/dismiss', ({ params, response }) => {
      sent.push(`dismiss ${params.id}`)
      return response(204).empty()
    }),
  )
  return sent
}

describe('the Originals available group in Needs attention', () => {
  it('names the Version\'s Profile by its name, not its key', async () => {
    fakeOffers([movieOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Show' }))
    expect(await within(section).findByText(/Standard · HD$/)).toBeInTheDocument()
    expect(within(section).queryByText(/hd-primary/)).not.toBeInTheDocument()
  })

  it('is one grouped row outside the badge that expands to one row per Version with Accept and Dismiss', async () => {
    const sent = fakeOffers([movieOffer, seriesOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    expect(await within(section).findByText('Originals available · 2')).toBeInTheDocument()
    expect(within(section).queryByText(/paddington/i)).not.toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Show' }))
    const items = within(section).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Paddington · Standard · HD')
    expect(items[0]).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP · Score 50')
    expect(items[1]).toHaveTextContent('Night Show · Standard')
    expect(items[1]).toHaveTextContent('S01 pack, S02E01')

    await userEvent.click(within(items[0]).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(sent).toEqual(['accept 11']))
    await userEvent.click(within(items[1]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(sent).toEqual(['accept 11', 'dismiss 21']))
  })

  it('does not say nothing needs attention while it shows', async () => {
    fakeOffers([movieOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    expect(await within(section).findByText('Originals available · 1')).toBeInTheDocument()
    expect(within(section).queryByText(/nothing needs attention/i)).not.toBeInTheDocument()
  })

  it('opens the Title from a row', async () => {
    fakeOffers([movieOffer])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Show' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Paddington' }))

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('does not show without offers', async () => {
    fakeOffers([])
    renderApp()
    const section = await screen.findByRole('region', { name: /needs attention/i })
    expect(await within(section).findByText(/nothing needs attention/i)).toBeInTheDocument()
    expect(within(section).queryByText(/originals available/i)).not.toBeInTheDocument()
  })
})

describe('the Original Offer indicator on the Title page', () => {
  async function openWith(offer: OriginalOffer | null) {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) =>
        response(200).json(
          detail(r, {
            versions: [
              { id: 11, slot: 'standard', profile: 'hd-primary', state: 'wanted', long_missing: false, wanted_since: r.wanted_since, file: null, added_at: r.added_at, original_offer: offer },
            ],
          }),
        ),
      ),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })
    return within(pane).findByRole('group', { name: 'Standard' })
  }

  it('says an original is available on the Version', async () => {
    const hd = await openWith(movieOffer)
    expect(within(hd).getByText('Original available')).toHaveAttribute('title', 'Paddington.2014.1080p.BluRay.x264-GRP · Score 50')
  })

  it('says when the offer was dismissed', async () => {
    const hd = await openWith({ ...movieOffer, dismissed: true })
    expect(within(hd).getByText('Original available, dismissed')).toBeInTheDocument()
  })

  it('is absent without an offer', async () => {
    const hd = await openWith(null)
    expect(within(hd).queryByText(/original available/i)).not.toBeInTheDocument()
  })
})

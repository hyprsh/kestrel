import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

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
  releases: [{ name: 'Paddington.2014.1080p.BluRay.x264-GRP', indexer: 'Alpha', score: 50, size: 8 << 20, published_at: '2026-10-18T08:00:00Z', season: null, pack: false, episodes: [] }],
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
  it("names the Version's Profile by its name, not its key", async () => {
    fakeOffers([movieOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Originals available · 1' }))
    expect(await within(section).findByText(/Standard · HD$/)).toBeInTheDocument()
    expect(within(section).queryByText(/hd-primary/)).not.toBeInTheDocument()
  })

  it('leaves the Profile out of a row when its name is the Slot label', async () => {
    fakeOffers([{ ...movieOffer, slot: '4k', profile: '4k-primary' }])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Originals available · 1' }))
    const item = within(section).getAllByRole('listitem')[1] // after the group's own row
    await waitFor(() => expect(item).toHaveTextContent('Paddington · 4K'))
    expect(item).not.toHaveTextContent('4K · 4K')
  })

  it('is one grouped row outside the badge that expands to one row per Version with Accept and Dismiss', async () => {
    const sent = fakeOffers([movieOffer, seriesOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    expect(await within(section).findByText('Originals available · 2')).toBeInTheDocument()
    expect(within(section).queryByText(/paddington/i)).not.toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Originals available · 2' }))
    const items = within(section).getAllByRole('listitem').slice(1) // after the group's own row
    expect(items[0]).toHaveTextContent('Paddington · Standard · HD')
    expect(items[0]).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-GRP · Score 50')
    expect(items[1]).toHaveTextContent('Night Show · Standard')
    expect(items[1]).toHaveTextContent('S01 pack, S02E01')

    await userEvent.click(within(items[0]).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(sent).toEqual(['accept 11']))
    expect(await findToast('Accepted the original for Paddington')).toBeInTheDocument()
    await userEvent.click(within(items[1]).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(sent).toEqual(['accept 11', 'dismiss 21']))
    expect(await findToast('Dismissed the original for Night Show')).toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Originals available · 2' }))
    expect(within(section).queryByText(/paddington/i)).not.toBeInTheDocument()
  })

  it('says in a Toast when Accept or Dismiss failed', async () => {
    fakeOffers([movieOffer])
    const refuse = ({ response }: { response: (s: 'default') => { json: (b: unknown, o: { status: number }) => unknown } }) =>
      response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'indexer offline' }, { status: 500 })
    server.use(http.post('/versions/{id}/original-offer/accept', refuse as never), http.post('/versions/{id}/original-offer/dismiss', refuse as never))
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Originals available · 1' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Accept' }))
    expect(await findToast('Could not accept the original for Paddington: indexer offline')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Dismiss' }))
    expect(await findToast('Could not dismiss the original for Paddington: indexer offline')).toBeInTheDocument()
  })

  it('does not say nothing needs attention while it shows', async () => {
    fakeOffers([movieOffer])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    expect(await within(section).findByText('Originals available · 1')).toBeInTheDocument()
    expect(within(section).queryByText(/nothing needs attention/i)).not.toBeInTheDocument()
  })

  it('opens the Title from a row', async () => {
    fakeOffers([movieOffer])
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Originals available · 1' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Paddington' }))

    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('shows each offer its Title poster, and the placeholder without a request when there is none', async () => {
    fakeOffers([
      { ...movieOffer, has_poster: true },
      { ...seriesOffer, has_poster: false },
    ])
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    await userEvent.click(await within(section).findByRole('button', { name: 'Originals available · 2' }))
    const offers = within(section).getAllByRole('listitem').slice(1) // after the group's own row

    expect(offers[0].querySelector('[data-poster] img')).toHaveAttribute('src', expect.stringMatching(/\/titles\/1\/poster$/))
    expect(offers[1].querySelector('[data-poster]')).toBeInTheDocument()
    expect(offers[1].querySelector('[data-poster] img')).not.toBeInTheDocument()
  })

  it('does not show without offers', async () => {
    fakeOffers([])
    renderApp()
    const section = await screen.findByRole('region', { name: /happening now/i })
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
    return within(pane).findByRole('listitem', { name: 'Standard' })
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

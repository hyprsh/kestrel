import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeLibrary, row, type TitleRow } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { passOf } from '../test/search'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** A Title with a Wanted Standard Version, Wanted for `days`; `long` makes it Long Missing. */
const wanted = (id: number, title: string, days: number, over: Partial<TitleRow> = {}, long = false): TitleRow =>
  row(id, title, title, {
    wanted_since: daysAgo(days),
    slots: { standard: { version_id: id * 10 + 1, profile: 'hd-primary', state: 'wanted', long_missing: long }, '4k': null },
    ...over,
  })

const status = (over: Record<string, unknown> = {}) =>
  server.use(
    http.get('/search/status', ({ response }) =>
      response(200).json({ due: { versions: 0, episodes: 0, upgrades: 0 }, pass: null, next_pass_at: null, last_pass: null, upgrades_per_pass: 5, indexers: [], ...over }),
    ),
  )

describe('Happening now, split in two cards', () => {
  it('shows Downloading and Searching side by side in one grid', async () => {
    renderApp()
    const left = await screen.findByRole('region', { name: 'Downloading' })
    const right = screen.getByRole('region', { name: 'Searching' })

    expect(left.parentElement).toBe(right.parentElement)
  })

  it('says so in each card when there is nothing', async () => {
    renderApp()

    expect(await within(await screen.findByRole('region', { name: 'Downloading' })).findByText('Nothing downloading')).toBeInTheDocument()
    expect(await within(screen.getByRole('region', { name: 'Searching' })).findByText('Nothing Wanted')).toBeInTheDocument()
  })

  it('adds the speed of the Grabs up in the Downloading header', async () => {
    fakeQueue([queueItem({ grab_id: 1, bytes_per_second: 20_000_000 }), queueItem({ grab_id: 2, bytes_per_second: 8_000_000 })])
    renderApp()

    const left = await screen.findByRole('region', { name: 'Downloading' })
    await within(left).findAllByRole('listitem')
    expect(left).toHaveTextContent('28 MB/s')
  })

  it('shows the time to the next pass in the Searching header', async () => {
    status({ next_pass_at: new Date(Date.now() + 54 * 60_000).toISOString() })
    renderApp()

    expect(await within(await screen.findByRole('region', { name: 'Searching' })).findByText('next pass in 54 min')).toBeInTheDocument()
  })

  it('lists the Wanted Versions, Long Missing first, then the longest Wanted, at most five, with why each is still missing', async () => {
    fakeLibrary([
      wanted(1, 'Newest', 1),
      wanted(2, 'Older', 20),
      wanted(3, 'Ancient', 100, {}, true),
      wanted(4, 'Middle', 5),
      wanted(5, 'Fresh', 0),
      wanted(6, 'Oldest Long', 200, {}, true),
      row(7, 'Filled', 'Filled', { slots: { standard: { version_id: 71, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null }, wanted_since: null }),
    ])
    renderApp()

    const card = await screen.findByRole('region', { name: 'Searching' })
    const rows = await within(card).findAllByRole('listitem')
    expect(within(card).getByRole('heading', { name: 'Wanted' }).nextElementSibling).toHaveTextContent('6')
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Oldest Long', 'Ancient', 'Older', 'Middle', 'Newest'])
    expect(rows[0]).toHaveTextContent('Long Missing · 200 days')
    expect(rows[0].textContent).toContain('Standard')
    expect(rows[1]).toHaveTextContent('Long Missing · 100 days')
    expect(rows[2]).toHaveTextContent('Wanted 20 days')
    expect(rows[4]).toHaveTextContent('Wanted 1 day')
  })

  it('names the Slot and the Wanted episodes of a Series', async () => {
    fakeLibrary([
      wanted(1, 'Breaking Bad', 3, {
        kind: 'series',
        wanted_episodes: { wanted: 3, long_missing: 0, seasons: [4] },
        slots: { standard: null, '4k': { version_id: 11, profile: '4k-primary', state: 'wanted', long_missing: false } },
      }),
    ])
    renderApp()

    const [item] = await within(await screen.findByRole('region', { name: 'Searching' })).findAllByRole('listitem')
    expect(item).toHaveTextContent('Breaking Bad 4K · 3 episodes')
  })

  it('searches the Version at once from the Search button, and says so in a Toast', async () => {
    fakeLibrary([wanted(1, 'Paddington 2', 3)])
    const sent: string[] = []
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (sent.push(String(params.id)), response(202).empty())))
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Search Paddington 2' }))

    await waitFor(() => expect(sent).toEqual(['11']))
    expect(await findToast('Search started for Paddington 2')).toBeInTheDocument()
  })

  it('opens the Title from a Wanted row', async () => {
    fakeLibrary([wanted(1, 'Paddington 2', 3)])
    renderApp()

    const card = await screen.findByRole('region', { name: 'Searching' })
    await userEvent.click(await within(card).findByRole('button', { name: /^Paddington 2/ }))
    expect(await screen.findByRole('region', { name: /paddington 2/i })).toBeInTheDocument()
  })

  it('"All Wanted" goes to the Library on is:wanted', async () => {
    renderApp()

    await userEvent.click(await within(await screen.findByRole('region', { name: 'Searching' })).findByRole('button', { name: 'All Wanted' }))
    expect(location.pathname + location.search).toBe('/library?q=is%3Awanted')
  })

  it('shows the running pass above the Wanted list, with the Wanted count', async () => {
    fakeLibrary([wanted(1, 'Paddington 2', 3)])
    status({
      pass: passOf({ done: 1, total: 4, releases_seen: 37, current: { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: '4K', season: 5, episodes: [], releases_seen: 12 } }),
    })
    renderApp()

    const card = await screen.findByRole('region', { name: 'Searching' })
    const pass = (await within(card).findByText('Searching Wanted')).closest('li')!
    expect(pass).toHaveTextContent('Searching Wanted · Breaking Bad S05 · 4K')
    expect(pass).toHaveTextContent('1 of 4 · 37 checked')
    expect(await within(card).findByText('Paddington 2')).toBeInTheDocument()
    expect(card).not.toHaveTextContent('next pass')
  })
})

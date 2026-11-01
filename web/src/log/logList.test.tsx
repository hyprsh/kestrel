import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Event = components['schemas']['Event']
type Bucket = components['schemas']['EventsBucket']

const event = (id: number, kind: string, message: string, over: Partial<Event> = {}): Event => ({
  id,
  at: new Date(Date.UTC(2026, 9, 17, 12, 0) - (100 - id) * 60_000).toISOString(),
  kind,
  routine: false,
  title_id: null,
  version_id: null,
  episode_id: null,
  grab_id: null,
  request_id: null,
  message,
  data: null,
  ...over,
})

/** What the Log asked for, and the events the server answers with: those of `items` with an id below `before`, newest first. */
function serve(items: () => Event[]) {
  const sent: URLSearchParams[] = []
  server.use(
    http.get('/events', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      sent.push(q)
      const before = q.has('before') ? Number(q.get('before')) : Infinity
      const limit = Number(q.get('limit') ?? 200)
      return response(200).json({
        items: items()
          .filter((e) => e.id < before)
          .sort((a, b) => b.id - a.id)
          .slice(0, limit),
      })
    }),
  )
  return sent
}

const rowsOf = () => [...document.querySelectorAll<HTMLElement>('[data-row]')]
const ready = () => waitFor(() => expect(rowsOf().length).toBeGreaterThan(0))

let client: QueryClient
async function openLog() {
  const user = userEvent.setup()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Log' }))
  return user
}

const bucket = (at: string, events: number, warnings: number, errors: number): Bucket => ({ at, events, warnings, errors })

beforeEach(() => {
  history.replaceState(null, '', '/')
})

describe('the strip', () => {
  const buckets = [bucket('2026-10-10T08:00:00Z', 200, 4, 0), bucket('2026-10-10T12:00:00Z', 659, 8, 3), bucket('2026-10-17T08:00:00Z', 0, 0, 0)]
  const strip = () => server.use(http.get('/events/histogram', ({ response }) => response(200).json({ bucket: '4h', buckets })))

  it('sums the days with a heading, a legend and a text alternative that says where the errors were', async () => {
    serve(() => [event(1, 'import', 'Imported R as /x')])
    strip()
    await openLog()

    const section = await screen.findByRole('region', { name: 'Events over time' })
    expect(within(section).getByRole('heading', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(within(section).getByText('874 events · 3 errors · 12 warnings')).toBeInTheDocument()
    for (const name of ['Events', 'Warnings', 'Errors']) expect(within(section).getByText(name)).toBeInTheDocument()
    const alt = within(section).getByRole('group').getAttribute('aria-label')
    expect(alt).toContain('Events per 4 hours over the last 7 days: 874 events · 3 errors · 12 warnings.')
    expect(alt).toMatch(/Errors on Oct 10 at \d\d:00\./)
    expect(alt).toMatch(/Warnings on Oct 10 at \d\d:00, Oct 10 at \d\d:00\./)
    expect(within(section).getAllByRole('button')).toHaveLength(3)
  })

  it('follows the days the Log covers, and says Today for one', async () => {
    serve(() => [event(1, 'import', 'Imported R as /x')])
    strip()
    let asked = ''
    server.use(
      http.get('/events/summary', ({ response }) => response(200).json({ counts: [], oldest: new Date(Date.now() - 3600_000).toISOString(), routine_days: 30 })),
      http.get('/events/histogram', ({ request, response }) => {
        asked = new URL(request.url).search
        return response(200).json({ bucket: '4h', buckets })
      }),
    )
    await openLog()

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(asked).toContain('days=1')
  })

  it('reads out a column on hover and on focus', async () => {
    serve(() => [event(1, 'import', 'Imported R as /x')])
    strip()
    const user = await openLog()
    const column = await screen.findByRole('button', { name: /659 events, 8 warnings, 3 errors/ })

    await user.hover(column)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('659events')
    expect(tip).toHaveTextContent('3errors')
    expect(tip).toHaveTextContent('8warnings')
    await user.unhover(column)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    column.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('659events')
  })

  it('loads older events when a column is older than the list, then scrolls to the newest event before its end', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    // 200 recent events (the first page), then older ones; the column is 12:00 to 16:00 on Oct 10.
    const recent = Array.from({ length: 200 }, (_, i) => ({ ...event(1000 + i, 'import', `Imported #${i}`), at: new Date(Date.UTC(2026, 9, 17, 12, 0) - i * 60_000).toISOString() }))
    const old = [
      { ...event(20, 'import', 'Imported on the 10th, late'), at: '2026-10-10T15:30:00Z' },
      { ...event(19, 'import', 'Imported on the 10th, early'), at: '2026-10-10T12:30:00Z' },
      { ...event(18, 'import', 'Imported on the 10th, before'), at: '2026-10-10T07:00:00Z' },
    ]
    const sent = serve(() => [...recent, ...old])
    strip()
    const user = await openLog()
    await ready()
    expect(sent).toHaveLength(1)

    await user.click(await screen.findByRole('button', { name: /659 events, 8 warnings, 3 errors/ }))

    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(sent.at(-1)?.get('before')).toBe('1000')
    const target = document.querySelector('[data-row="20"]')
    expect(target).toHaveTextContent('Imported')
    expect(scroll.mock.contexts.at(-1)).toBe(target)
  })
})

describe('Follow live', () => {
  const log = [event(2, 'import', 'Imported Heat as /heat.mkv'), event(1, 'import', 'Imported Paddington as /p.mkv')]

  it('is on by default: events that arrive show at the top at once', async () => {
    let items = log
    serve(() => items)
    await openLog()
    await ready()
    expect(screen.getByRole('switch', { name: 'Follow live' })).toBeChecked()

    items = [event(3, 'grab', 'Sent R to the download client'), ...log]
    await client.invalidateQueries({ queryKey: ['log'] })

    await waitFor(() => expect(rowsOf()).toHaveLength(3))
    expect(rowsOf()[0]).toHaveTextContent('Grabbed')
    expect(screen.queryByRole('button', { name: /new event/ })).not.toBeInTheDocument()
  })

  it('off, keeps the list where it is and offers the new events in a pill, and the choice is kept for this browser', async () => {
    let items = log
    serve(() => items)
    const user = await openLog()
    await ready()

    await user.click(screen.getByRole('switch', { name: 'Follow live' }))
    expect(localStorage.getItem('kestrel.log.follow')).toBe('off')
    items = [event(4, 'grab_failed', 'Download failed (x): R'), event(3, 'grab', 'Sent R to the download client'), ...log]
    await client.invalidateQueries({ queryKey: ['log'] })

    const pill = await screen.findByRole('button', { name: '2 new events' })
    expect(rowsOf()).toHaveLength(2)

    await user.click(pill)
    await waitFor(() => expect(rowsOf()).toHaveLength(4))
    expect(rowsOf()[0]).toHaveTextContent('Download failed')
    expect(screen.queryByRole('button', { name: /new events?$/ })).not.toBeInTheDocument()

    // Turned on again, new events show without the pill.
    await user.click(screen.getByRole('switch', { name: 'Follow live' }))
    expect(localStorage.getItem('kestrel.log.follow')).toBe('on')
  })

  it('starts off in a browser that turned it off', async () => {
    localStorage.setItem('kestrel.log.follow', 'off')
    serve(() => log)
    await openLog()
    await ready()
    expect(screen.getByRole('switch', { name: 'Follow live' })).not.toBeChecked()
  })
})

describe('folded routine events', () => {
  const search = (id: number, scope: string, result: string) => event(id, 'search', `Searched by hand for ${scope} in Standard: ${result}`, { routine: true, title_id: 3 })

  it('folds a run into one gray row with its counts, lists five compactly and shows the rest on request', async () => {
    fakeLibrary([row(3, 'Breaking Bad', 'Breaking Bad')])
    serve(() => [
      event(20, 'import', 'Imported R as /x'),
      ...[19, 18, 17, 16, 15, 14, 13].map((id, i) => search(id, `S0${i + 1}`, id === 19 ? 'grabbed 1 Release' : 'nothing to grab')),
      event(12, 'import', 'Imported Q as /y'),
    ])
    const user = await openLog()
    await ready()

    expect(rowsOf()).toHaveLength(3)
    const fold = rowsOf()[1]
    expect(fold).toHaveTextContent('7 searches · 1 Grab')
    expect(within(fold).queryByText(/Searched/)).not.toBeInTheDocument()

    await user.click(within(fold).getByRole('button', { name: 'Show 7 routine events' }))
    expect(within(fold).getAllByText(/^Searched/)).toHaveLength(5)
    expect(within(fold).getAllByText(/^Searched/)[0]).toHaveTextContent('Searched Breaking Bad S01 · Standard · grabbed 1 Release')
    expect(fold).toHaveTextContent('… 2 more')

    await user.click(within(fold).getByRole('button', { name: 'Show all' }))
    expect(within(fold).getAllByText(/^Searched/)).toHaveLength(7)

    await user.click(within(fold).getByRole('button', { name: 'Hide 7 routine events' }))
    expect(within(fold).queryByText(/^Searched/)).not.toBeInTheDocument()
  })
})

describe('an opened event', () => {
  const failed = (id: number, reason: string, at: string, over: Partial<Event> = {}) =>
    event(id, 'grab_failed', `Download failed (${reason}): Paddington.1080p-GRP`, { at, title_id: 3, grab_id: 11, ...over })

  it('opens one at a time, with Enter, and shows an error with the times it happened before', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    serve(() => [
      failed(30, 'encrypted', '2026-10-17T12:12:00Z'),
      event(29, 'import', 'Imported Heat as /heat.mkv'),
      failed(28, 'encrypted', '2026-10-15T18:02:00Z'),
      failed(27, 'disk full', '2026-10-14T09:00:00Z'),
      failed(26, 'encrypted', '2026-10-12T03:40:00Z'),
    ])
    const user = await openLog()
    await ready()

    await user.click(document.body)
    await user.keyboard('{Enter}')
    const error = rowsOf()[0]
    const first = within(error).getByRole('button', { name: /^Close event: Download failed/ })
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(within(error).getByText('Error')).toBeInTheDocument()
    expect(within(error).getByText('encrypted', { selector: 'dd' })).toBeInTheDocument()
    expect(within(error).getByText('Release')).toBeInTheDocument()
    expect(within(error).getByText('Affected')).toBeInTheDocument()
    expect(within(error).getByText('Paddington · Grab 11')).toBeInTheDocument()

    // The earlier times of the same error: the same reason only, the other reason's time is left out.
    const same = await within(error).findByText('Same error before')
    const box = same.parentElement!
    expect(box).toHaveTextContent(/Oct 15, \d\d:\d\d · Oct 12, \d\d:\d\d/)
    expect(box).not.toHaveTextContent('Oct 14')
    expect(box).toHaveTextContent('3 times since Oct 12.')

    // Opening another closes this one.
    await user.click(within(rowsOf()[1]).getByRole('button', { name: /^Open event: Imported/ }))
    expect(within(error).getByRole('button', { name: /^Open event: Download failed/ })).toHaveAttribute('aria-expanded', 'false')
    expect(within(rowsOf()[1]).getByRole('button', { name: /^Close event/ })).toBeInTheDocument()
    expect(screen.queryByText('Same error before')).not.toBeInTheDocument()
  })

  it('says it is the first time when nothing like it came before, and leaves Affected out when the event records nothing', async () => {
    serve(() => [event(5, 'import_rejected', 'Import of R rejected: not_upgrade')])
    const user = await openLog()
    await ready()

    await user.click(within(rowsOf()[0]).getByRole('button', { name: /^Open event/ }))
    expect(await screen.findByText('First time in the Log')).toBeInTheDocument()
    expect(screen.queryByText('Affected')).not.toBeInTheDocument()
  })

  it('shows a Grab with its Release, indexer, Score with formats, why and where it stands now', async () => {
    fakeLibrary([row(3, 'Breaking Bad', 'Breaking Bad')])
    serve(() => [event(7, 'grab', 'Sent Breaking.Bad.S05.2160p-NTb to the download client', { title_id: 3, grab_id: 11, data: { by: 'by_search' } })])
    server.use(
      http.get('/grabs/{id}', ({ response }) =>
        response(200).json({
          id: 11,
          title_id: 3,
          version_id: 31,
          release_name: 'Breaking.Bad.S05.2160p-NTb',
          indexer: 'NZBgeek',
          size: 1,
          published_at: '2026-10-17T12:00:00Z',
          score: 2350,
          client_id: 'n',
          state: 'downloading',
          overridden: false,
          is_upgrade: false,
          created_at: '2026-10-17T12:00:00Z',
        }),
      ),
      http.get('/grabs/{id}/steps', ({ response }) =>
        response(200).json({
          grab_id: 11,
          grabbed_at: '2026-10-17T12:00:00Z',
          grabbed_by: 'by_search',
          download_started_at: null,
          download_finished_at: null,
          ended_at: null,
          files: [],
          formats: [
            { name: 'WEB Tier 01', score: 1700 },
            { name: 'HDR', score: 500 },
          ],
          blocklist_id: null,
          still_wanted: true,
          why: { covers_wanted: 6, replaces_files: 4, score_delta: 250 },
          replaced: null,
        }),
      ),
    )
    const user = await openLog()
    await ready()

    await user.click(within(rowsOf()[0]).getByRole('button', { name: /^Open event/ }))
    const detail = rowsOf()[0]
    expect(await within(detail).findByText('NZBgeek')).toBeInTheDocument()
    expect(within(detail).getByText('Breaking.Bad.S05.2160p-NTb', { selector: 'dd' })).toBeInTheDocument()
    expect(within(detail).getByText('2,350 · WEB Tier 01 +1,700 · HDR +500')).toBeInTheDocument()
    expect(within(detail).getByText('Search pass · covers 6 Wanted, replaces 4 at +250')).toBeInTheDocument()
    expect(within(detail).getByText(/^Downloading/)).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: 'View in Activity' }))
    expect(location.pathname).toBe('/activity')
  })

  it('tells an error that came back how often Kestrel retried, when it was back and which Grabs waited', async () => {
    serve(() => [
      event(9, 'health_raised', 'SABnzbd refused the connection', { data: { key: 'download_client', kind: 'download_client_unreachable', severity: 'blocking' } }),
      event(12, 'health_cleared', 'Cleared: SABnzbd refused the connection', {
        data: {
          key: 'download_client',
          kind: 'download_client_unreachable',
          severity: 'blocking',
          attempts: ['2026-10-17T12:12:00Z', '2026-10-17T12:13:00Z', '2026-10-17T12:14:00Z'],
          recovered_at: '2026-10-17T12:15:00Z',
          waited: 2,
          lost: 0,
        },
      }),
    ])
    const user = await openLog()
    await ready()
    const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

    const row = rowsOf().find((r) => r.textContent?.includes('SABnzbd refused the connection') && !r.textContent?.includes('Cleared'))!
    expect(await within(row).findByText(`· Kestrel retried 3 times, then it came back at ${at('2026-10-17T12:15:00Z')}`)).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: /^Open event/ }))
    expect(within(row).getByText(`${['2026-10-17T12:12:00Z', '2026-10-17T12:13:00Z', '2026-10-17T12:14:00Z'].map(at).join(', ')} · back at ${at('2026-10-17T12:15:00Z')}`)).toBeInTheDocument()
    expect(within(row).getByText('2 Grabs waited · none lost')).toBeInTheDocument()
  })

  it('has actions under the fields: the place that puts it right, only these errors, and Copy Details', async () => {
    fakeLibrary([row(3, 'Paddington', 'Paddington')])
    serve(() => [
      event(9, 'health_raised', 'SABnzbd refused the connection', { data: { key: 'dl', kind: 'download_client_unreachable', severity: 'blocking' } }),
      failed(8, 'encrypted', '2026-10-17T12:12:00Z'),
    ])
    const user = await openLog()
    await ready()

    // The hover action is on the row itself.
    expect(within(rowsOf()[0]).getByRole('button', { name: 'Open Download Settings' })).toBeInTheDocument()

    await user.click(within(rowsOf()[1]).getByRole('button', { name: /^Open event/ }))
    await user.click(within(rowsOf()[1]).getByRole('button', { name: 'Show Only These Errors' }))
    expect(screen.getByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:grab_failed')

    // A new filter closes the event; open it again.
    const reopen = () => user.click(within(rowsOf()[1]).getByRole('button', { name: /^Open event/ }))
    await reopen()
    await user.click(screen.getByRole('button', { name: 'Show Only This Title' }))
    expect(screen.getByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:grab_failed title:Paddington')

    await reopen()
    await user.click(screen.getByRole('button', { name: 'Copy Details' }))
    expect(await navigator.clipboard.readText()).toContain('Error: encrypted')
    expect(await screen.findByText('Copied the details')).toBeInTheDocument()
  })
})

describe('on a phone', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  afterEach(() => vi.unstubAllGlobals())

  it('opens an event under its sentence', async () => {
    serve(() => [event(5, 'import_rejected', 'Import of R rejected: not_upgrade')])
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Log' }))
    await ready()

    await user.click(within(rowsOf()[0]).getByRole('button', { name: /^Open event/ }))
    expect(within(rowsOf()[0]).getByText('not_upgrade', { selector: 'dd' })).toBeInTheDocument()
  })
})

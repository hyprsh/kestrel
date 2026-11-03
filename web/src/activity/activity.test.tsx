import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { blockedEntry, fakeGrabs, fakeSteps, grabEntry, stepsOf } from '../test/grabs'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { passOf } from '../test/search'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openActivity() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
}

const stalled = { reason: 'disk full', since: new Date(Date.now() - 20 * 60_000).toISOString(), next_at: new Date(Date.now() + 5 * 60_000).toISOString() }

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

function fakeDownloadClient() {
  server.use(
    http.get('/plugin-instances', ({ response }) =>
      response(200).json({
        items: [
          {
            id: 3,
            contract: 'download_client.v1',
            plugin_id: 'sabnzbd',
            name: 'SABnzbd',
            enabled: true,
            priority: 1,
            config: { url: 'http://sab.test:8080' },
            secrets_set: [],
            from_config_file: false,
            enabled_declared: false,
            last_check: null,
          },
        ],
        next_cursor: null,
      }),
    ),
  )
}

describe('Activity', () => {
  it('shows only Grabs: the panel starts with the filter field and has no view switcher', async () => {
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' })])
    await openActivity()
    expect(await screen.findByRole('combobox', { name: 'Filter Activity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Activity:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Background jobs/ })).not.toBeInTheDocument()
  })

  it('has the Views Everything, In progress, Imported and Failed with counts, Failed’s in red, and a footer saying how far back it goes', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' }), queueItem({ grab_id: 2, phase: 'queued' })])
    fakeGrabs([
      grabEntry({ grab_id: 6, state: 'importing', stalled }),
      grabEntry({ grab_id: 7, state: 'imported', updated_at: ago(60) }),
      grabEntry({ grab_id: 8, state: 'imported', updated_at: ago(70) }),
      grabEntry({ grab_id: 9, state: 'failed', failure: 'download_failed', updated_at: ago(80) }),
    ])
    await openActivity()

    const views = within(await screen.findByRole('navigation', { name: 'Views' }))
    expect(views.getAllByRole('button').map((b) => b.textContent?.replace(/[\d,\s]+$/, ''))).toEqual(['Everything', 'In progress', 'Imported', 'Failed'])
    await waitFor(() => expect(views.getByRole('button', { name: /^Failed/ })).toHaveTextContent('1'))
    expect(views.getByRole('button', { name: /^Everything/ })).toHaveTextContent('6')
    expect(views.getByRole('button', { name: /^In progress/ })).toHaveTextContent('3') // two downloads and a stalled Import
    expect(views.getByRole('button', { name: /^Imported/ })).toHaveTextContent('2')
    expect(screen.getByText(/^6 Grabs · since [A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeInTheDocument()
  })

  it('shows In progress above History: one row per live Grab with its state, and the Grabs that ended by day', async () => {
    fakeQueue([
      queueItem({ grab_id: 1, phase: 'queued', release_name: 'A.Queued-GRP' }),
      queueItem({ grab_id: 3, phase: 'downloading', release_name: 'C.Downloading-GRP', slot: '4k', episodes: ['S05E07'], title: 'Breaking Bad' }),
      queueItem({ grab_id: 5, phase: 'importing', release_name: 'E.Importing-GRP', checking_files: 2 }),
    ])
    fakeGrabs([
      grabEntry({ grab_id: 6, state: 'importing', stalled, release_name: 'F.Stalled-GRP' }),
      grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' }),
      grabEntry({ grab_id: 8, state: 'failed', failure: 'download_failed', release_name: 'H.Failed-GRP' }),
    ])
    await openActivity()

    const live = within(await screen.findByRole('region', { name: 'In progress' }))
    expect(live.getByRole('heading', { name: /^In progress/ })).toHaveTextContent('In progress 4')
    const rows = live.getAllByRole('listitem')
    expect(rows.map((li) => li.textContent)).toEqual([
      expect.stringContaining('A.Queued-GRP'),
      expect.stringContaining('C.Downloading-GRP'),
      expect.stringContaining('E.Importing-GRP'),
      expect.stringContaining('F.Stalled-GRP'),
    ])
    expect(rows[0]).toHaveTextContent('Queued')
    expect(rows[1]).toHaveTextContent('Breaking Bad')
    expect(rows[1]).toHaveTextContent('S05E07')
    expect(within(rows[1]).getByRole('img', { name: /^4K: Downloading/ })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Downloading · 75% · 2 min · ')
    expect(within(rows[1]).getByRole('progressbar', { name: 'C.Downloading-GRP progress' })).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Importing · checking 2 files')
    expect(rows[3]).toHaveTextContent('Stalled · disk full')

    const history = within(screen.getByRole('region', { name: 'History' }))
    expect(history.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    expect(history.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(history.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('G.Imported-GRP'), expect.stringContaining('H.Failed-GRP')])
  })

  it('groups History under Today, Yesterday and dated day headers, newest first', async () => {
    const at = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()
    fakeGrabs([
      grabEntry({ grab_id: 3, release_name: 'Today.One-GRP', updated_at: at(0, 0.1) }),
      grabEntry({ grab_id: 2, release_name: 'Yesterday.One-GRP', updated_at: at(1) }),
      grabEntry({ grab_id: 1, release_name: 'Old.One-GRP', state: 'failed', failure: 'download_failed', updated_at: at(9) }),
    ])
    await openActivity()

    const history = within(await screen.findByRole('region', { name: 'History' }))
    const heads = history.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(heads).toHaveLength(3)
    expect(heads.slice(0, 2)).toEqual(['Today', 'Yesterday'])
    expect(heads[2]).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    expect(within(history.getByRole('list', { name: 'Today' })).getByText('Today.One-GRP')).toBeInTheDocument()
    expect(within(history.getByRole('list', { name: heads[2]! })).getByText('Old.One-GRP')).toBeInTheDocument()
  })

  it('shows a History row as its time, Title with what it covers, Release, Result, Size and Score, failures in red with the reason in the tooltip', async () => {
    fakeGrabs([
      grabEntry({
        grab_id: 2,
        title: 'Breaking Bad',
        slot: '4k',
        episodes: ['S05E09'],
        state: 'failed',
        failure: 'language',
        blocklist_reason: 'import rejected: language',
        release_name: 'BB.S05E09-GRP',
        size: 4.2 * 1024 ** 3,
        score: 1450,
        updated_at: ago(5),
      }),
      grabEntry({ grab_id: 1, release_name: 'Paddington.2014-GRP', size: 8 * 1024 ** 3, score: 1850, updated_at: ago(30) }),
    ])
    await openActivity()

    const [failed, imported] = within(await screen.findByRole('region', { name: 'History' })).getAllByRole('listitem')
    expect(failed).toHaveTextContent('Breaking Bad')
    expect(failed).toHaveTextContent('S05E09')
    expect(within(failed).getByRole('img', { name: '4K: Wanted' })).toBeInTheDocument()
    expect(failed).toHaveTextContent('BB.S05E09-GRP')
    expect(failed).toHaveTextContent('Failed · language')
    expect(failed).toHaveTextContent('4.2 GB')
    expect(failed).toHaveTextContent('1,450')
    expect(within(failed).getByTitle('language (Blocklisted: import rejected: language)')).toHaveTextContent('Failed · language')
    expect(imported).toHaveTextContent('Imported')
    expect(imported).toHaveTextContent('8.0 GB')
    expect(imported).toHaveTextContent('1,850')
  })

  it('pages History as far back as there are Grabs, loading the next page as the list ends', async () => {
    const old = (n: number) => grabEntry({ grab_id: 1000 - n, release_name: `Old${n}.Release-GRP`, updated_at: new Date(Date.now() - (n + 30) * 86_400_000).toISOString() })
    const grabs = fakeGrabs(Array.from({ length: 120 }, (_, n) => old(n)))
    await openActivity()

    const rowsShown = () => within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')
    await screen.findByRole('region', { name: 'History' })
    expect(rowsShown()).toHaveLength(50)
    const first = grabs.queries.find((q) => q.getAll('state').length > 0)!
    expect(first.getAll('state')).toEqual(['imported', 'failed'])
    expect(first.has('since')).toBe(false)
    expect(first.get('limit')).toBe('50')

    await userEvent.click(screen.getByRole('button', { name: 'Load older Grabs' }))
    await waitFor(() => expect(rowsShown()).toHaveLength(100))
    await userEvent.click(screen.getByRole('button', { name: 'Load older Grabs' }))
    await waitFor(() => expect(rowsShown()).toHaveLength(120))
    expect(screen.getByText('That is all the history.')).toBeInTheDocument()
    expect(grabs.queries.some((q) => q.get('stalled') === 'true')).toBe(true)
  })

  it('counts and filters over the whole history, not only the loaded page, and says how far back it goes', async () => {
    const at = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    fakeGrabs([
      ...Array.from({ length: 60 }, (_, n) => grabEntry({ grab_id: 500 - n, release_name: `Recent${n}.Release-GRP`, updated_at: at(1 + n / 100) })),
      grabEntry({ grab_id: 3, state: 'failed', failure: 'download_failed', release_name: 'Ancient.Failure-GRP', updated_at: at(400) }),
    ])
    await openActivity()

    const views = within(await screen.findByRole('navigation', { name: 'Views' }))
    await waitFor(() => expect(views.getByRole('button', { name: /^Failed/ })).toHaveTextContent('1'))
    expect(views.getByRole('button', { name: /^Everything/ })).toHaveTextContent('61')
    expect(screen.getByText(/^61 Grabs · since /)).toBeInTheDocument()
    expect(screen.queryByText(/Ancient/)).not.toBeInTheDocument() // beyond the first page

    await userEvent.click(views.getByRole('button', { name: /^Failed/ }))
    const region = await screen.findByRole('region', { name: 'History' })
    expect(await within(region).findByText(/Ancient\.Failure-GRP/)).toBeInTheDocument()
  })

  it('shows a download as its state, Progress bar, time left and the speed its ETA implies', async () => {
    fakeQueue([queueItem({ phase: 'downloading', size: 8 * 1024 ** 3, bytes_total: 8 * 1024 ** 3, bytes_left: 600 * 1024 ** 2, eta: 60 })])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'In progress' })).getByRole('listitem')
    expect(row).toHaveTextContent('Downloading · 93% · 1 min · 10 MB/s')
    expect(within(row).getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows the speed the client reports in place of the one the ETA implies', async () => {
    fakeQueue([queueItem({ phase: 'downloading', bytes_total: 8 * 1024 ** 3, bytes_left: 600 * 1024 ** 2, eta: 60, bytes_per_second: 28_000_000 })])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'In progress' })).getByRole('listitem')
    expect(row).toHaveTextContent('Downloading · 93% · 1 min · 28 MB/s')
  })

  it('keeps the Views out of the Filter menu on a desktop: it refines by Kind and Slot, never lists Titles, and its badge counts only those', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' })])
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported' }), grabEntry({ grab_id: 8, state: 'failed', failure: 'download_failed' })])
    await openActivity()

    await screen.findByRole('region', { name: 'History' })
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    for (const view of [/^In progress/, /^Imported/, /^Failed/, /^Everything/]) expect(screen.queryByRole('menuitemcheckbox', { name: view })).not.toBeInTheDocument()
    expect(screen.getAllByText('Views')).toHaveLength(1) // the panel's own, not one in the menu
    expect(screen.queryByRole('menuitemcheckbox', { name: /Paddington/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Series/ }))
    expect(screen.getByRole('combobox', { name: 'Filter Activity' })).toHaveValue('kind:series')
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    // A stage typed in the field narrows the list but is not a refinement of the menu.
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter Activity' }), ' stage:done')
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument()
  })

  it('opens on one Grab from its address with grab:<id>, in whatever stage it is in, and clearing the filter shows the rest', async () => {
    history.replaceState(null, '', '/activity?q=grab:42')
    fakeQueue([queueItem({ grab_id: 41, phase: 'downloading', release_name: 'Other.Downloading-GRP' })])
    fakeGrabs([
      grabEntry({ grab_id: 42, state: 'failed', failure: 'download_failed', release_name: 'Mine.Failed-GRP' }),
      grabEntry({ grab_id: 43, state: 'imported', release_name: 'Other.Imported-GRP' }),
    ])
    renderApp()

    const row = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    expect(row).toHaveTextContent('Mine.Failed-GRP')
    expect(screen.queryByText('Other.Downloading-GRP')).not.toBeInTheDocument()
    expect(screen.queryByText('Other.Imported-GRP')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('combobox', { name: 'Filter Activity' }))
    expect(await screen.findByText('Other.Downloading-GRP')).toBeInTheDocument()
    expect(screen.getByText('Other.Imported-GRP')).toBeInTheDocument()
  })

  it('opens on the Grabs that finished on a day and in a stage from day: and stage:, leaving out what is still in progress', async () => {
    history.replaceState(null, '', '/activity?q=stage:done+day:2026-10-16')
    fakeQueue([queueItem({ grab_id: 41, phase: 'downloading', release_name: 'Other.Downloading-GRP' })])
    const grabs = fakeGrabs([
      grabEntry({ grab_id: 1, state: 'imported', release_name: 'That.Day-GRP', updated_at: '2026-10-16T09:30:00Z' }),
      grabEntry({ grab_id: 2, state: 'imported', release_name: 'Next.Day-GRP', updated_at: '2026-10-17T09:30:00Z' }),
      grabEntry({ grab_id: 3, state: 'failed', failure: 'download_failed', release_name: 'Failed.That.Day-GRP', updated_at: '2026-10-16T10:30:00Z' }),
    ])
    renderApp()

    const row = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    expect(row).toHaveTextContent('That.Day-GRP')
    expect(screen.queryByText('Next.Day-GRP')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed.That.Day-GRP')).not.toBeInTheDocument()
    expect(screen.queryByText('Other.Downloading-GRP')).not.toBeInTheDocument()
    expect(grabs.queries.at(-1)?.getAll('day')).toEqual(['2026-10-16'])
  })

  it('sends an indexer and a range to the server, and names the indexer on its chip', async () => {
    history.replaceState(null, '', '/activity?q=from:2026-10-02+to:2026-10-31+indexer:3')
    server.use(
      http.get('/plugin-instances', ({ response }) =>
        response(200).json({
          items: [
            {
              id: 3,
              contract: 'indexer.v1',
              plugin_id: 'newznab',
              name: 'altHUB',
              enabled: true,
              priority: 1,
              config: {},
              secrets_set: [],
              from_config_file: false,
              enabled_declared: false,
              last_check: null,
            },
          ],
          next_cursor: null,
        }),
      ),
    )
    fakeQueue([])
    const grabs = fakeGrabs([grabEntry({ grab_id: 1, state: 'imported', release_name: 'In.Range-GRP', updated_at: '2026-10-16T09:30:00Z' })])
    renderApp()

    expect(await screen.findByText('In.Range-GRP')).toBeInTheDocument()
    const q = grabs.queries.at(-1)!
    expect(q.getAll('indexer')).toEqual(['3'])
    expect(q.get('from')).toBe('2026-10-02')
    expect(q.get('to')).toBe('2026-10-31')
    expect(await screen.findByText('altHUB')).toBeInTheDocument()
  })

  it('shows the no-match state for a grab: id that matches nothing', async () => {
    history.replaceState(null, '', '/activity?q=grab:999')
    fakeQueue([queueItem({ grab_id: 41, phase: 'downloading', release_name: 'Other.Downloading-GRP' })])
    fakeGrabs([])
    renderApp()

    await screen.findByRole('combobox', { name: 'Filter Activity' })
    await waitFor(() => expect(screen.queryByText('Other.Downloading-GRP')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument()
    expect(screen.getByText('Nothing in Activity matches.')).toBeInTheDocument()
  })

  it('sets the stage filter from the Views, and Everything clears it', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' })])
    fakeGrabs([grabEntry({ grab_id: 2, state: 'imported' }), grabEntry({ grab_id: 3, state: 'failed' })])
    await openActivity()

    const views = within(await screen.findByRole('navigation', { name: 'Views' }))
    expect(await views.findByRole('button', { name: /^Everything/ })).toHaveAttribute('aria-current', 'true')
    await userEvent.click(views.getByRole('button', { name: /^Failed/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')).toHaveLength(1)
    expect(views.getByRole('button', { name: /^Failed/ })).toHaveAttribute('aria-current', 'true')

    await userEvent.click(views.getByRole('button', { name: /^Imported/ }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')[0]).toHaveTextContent('Imported'))
    expect(within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')).toHaveLength(1)

    await userEvent.click(views.getByRole('button', { name: /^In progress/ }))
    expect(await screen.findByRole('region', { name: 'In progress' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'History' })).not.toBeInTheDocument()
    await userEvent.click(views.getByRole('button', { name: /^Everything/ }))
    expect(await screen.findByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'In progress' })).toBeInTheDocument()
  })

  it('lists grab: in the filter help', async () => {
    fakeQueue([])
    fakeGrabs([])
    await openActivity()

    await userEvent.click(await screen.findByRole('button', { name: 'Query Help' }))
    const help = screen.getByRole('dialog', { name: 'Query Help' })
    expect(within(help).getByText('grab:')).toBeInTheDocument()
  })

  it('opens on a stage from its address, as the Overview links to it', async () => {
    history.replaceState(null, '', '/activity?q=stage:done')
    fakeQueue([queueItem({ phase: 'downloading' })])
    fakeGrabs([grabEntry({ state: 'imported' })])
    renderApp()

    expect(await screen.findByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('narrows the list to Movies or Series, a Slot and text', async () => {
    fakeQueue([
      queueItem({ grab_id: 1, title: 'Paddington', kind: 'movie', slot: 'standard', release_name: 'Paddington.2014-GRP' }),
      queueItem({ grab_id: 2, title: 'Severance', kind: 'series', slot: '4k', release_name: 'Severance.S02-GRP', episodes: ['S02E01'] }),
      queueItem({ grab_id: 3, title: 'Heat', kind: 'movie', slot: '4k', release_name: 'Heat.1995.2160p-GRP', indexer: 'DrunkenSlug' }),
    ])
    await openActivity()
    const field = await screen.findByRole('combobox', { name: 'Filter Activity' })
    const shown = () =>
      within(screen.getByRole('region', { name: 'In progress' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)

    await userEvent.type(field, 'kind:movie ')
    expect(shown()).toEqual([expect.stringContaining('Paddington'), expect.stringContaining('Heat')])
    await userEvent.type(field, 'slot:4k ')
    expect(shown()).toEqual([expect.stringContaining('Heat')])
    await userEvent.clear(field)
    await userEvent.type(field, 'drunkenslug')
    expect(shown()).toEqual([expect.stringContaining('Heat')])
    expect(screen.getByRole('heading', { name: /^In progress/ })).toHaveTextContent('In progress 1')
  })

  it('cancels an active Grab with its ×, or with the ⋯ menu with or without blocklisting, and opens the Title and the download client from it', async () => {
    fakeDownloadClient()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    fakeLibrary([row(5, 'Paddington', 'Paddington'), row(6, 'Heat', 'Heat')])
    const queue = fakeQueue([queueItem({ grab_id: 1 }), queueItem({ grab_id: 2, release_name: 'Other-GRP', title: 'Heat', title_id: 6 })])
    await openActivity()

    const region = await screen.findByRole('region', { name: 'In progress' })
    const [first, second] = within(region).getAllByRole('listitem')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel Paddington' }))
    await waitFor(() => expect(queue.cancels).toEqual([{ id: '1', body: { blocklist: false } }]))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'In progress' })).getAllByRole('listitem')).toHaveLength(1))

    await userEvent.click(within(second).getByRole('button', { name: 'More for Heat' }))
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Cancel', 'Cancel and Blocklist', 'Open in SABnzbd', 'Open Heat'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open in SABnzbd' }))
    expect(open).toHaveBeenCalledWith('http://sab.test:8080', '_blank', 'noopener')

    await userEvent.click(within(second).getByRole('button', { name: 'More for Heat' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Cancel and Blocklist' }))
    await waitFor(() =>
      expect(queue.cancels).toEqual([
        { id: '1', body: { blocklist: false } },
        { id: '2', body: { blocklist: true } },
      ]),
    )
    open.mockRestore()
  })

  it('leaves “Open in” out of the ⋯ menu when no download client has a URL', async () => {
    fakeQueue([queueItem({ grab_id: 1 })])
    await openActivity()

    await userEvent.click(await screen.findByRole('button', { name: 'More for Paddington' }))
    expect(
      within(await screen.findByRole('menu'))
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Cancel', 'Cancel and Blocklist', 'Open Paddington'])
  })

  it('retries a stalled Import or discards it after asking', async () => {
    const sent: string[] = []
    server.use(
      http.post('/grabs/{id}/retry-import', ({ params, response }) => (sent.push(`retry ${params.id}`), response(204).empty())),
      http.post('/grabs/{id}/discard', ({ params, response }) => (sent.push(`discard ${params.id}`), response(204).empty())),
    )
    const confirm = vi.spyOn(window, 'confirm')
    fakeGrabs([grabEntry({ grab_id: 6, state: 'importing', stalled })])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'In progress' })).getByRole('listitem')
    expect(row).toHaveTextContent('Stalled · disk full')
    await userEvent.click(within(row).getByRole('button', { name: 'More for Paddington' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Retry now' }))
    await waitFor(() => expect(sent).toEqual(['retry 6']))
    await userEvent.click(within(row).getByRole('button', { name: 'Discard Paddington' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this Grab' })
    expect(dialog).toHaveTextContent('Its downloaded files are deleted and the Version is searched for again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(sent).toEqual(['retry 6'])
    await userEvent.click(within(row).getByRole('button', { name: 'Discard Paddington' }))
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard this Grab' })).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(sent).toEqual(['retry 6', 'discard 6']))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('opens an imported row in place with its steps, files and Custom Formats, and Open Title and Show in Log', async () => {
    fakeDownloadClient()
    fakeLibrary([row(5, 'Paddington', 'Paddington')])
    const steps = fakeSteps([stepsOf({ grab_id: 21 })])
    fakeGrabs([grabEntry({ grab_id: 21, indexer: 'NZBgeek', size: 3.2 * 1024 ** 3 })])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    expect(item).not.toHaveTextContent('What happened')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))

    expect(await within(item).findByText('What happened')).toBeInTheDocument()
    expect(steps.asked).toEqual([21])
    const timeline = within(within(item).getByRole('list', { name: 'What happened' }))
    expect(timeline.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringMatching(/Grabbed by the search pass · NZBgeek$/),
      expect.stringMatching(/Downloaded in SABnzbd · 3\.2 GB at 5 MB\/s$/),
      expect.stringMatching(/Imported 1 file$/),
    ])
    expect(within(item).getByText('Files')).toBeInTheDocument()
    expect(item.querySelector('[dir="rtl"] bdi')).toHaveTextContent('/media/movies/Paddington (2014)/Paddington (2014) - [Bluray-1080p].mkv')
    expect(within(item).getByText('Remux Tier 01 +1600')).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /Search/ })).not.toBeInTheDocument()

    await userEvent.click(within(item).getByRole('button', { name: 'Show in Log' }))
    expect(await screen.findByRole('combobox', { name: /Log/i })).toHaveValue('title:Paddington')
  })

  it('opens one row at a time, with ↵, and closes it again', async () => {
    fakeSteps([stepsOf({ grab_id: 1 }), stepsOf({ grab_id: 2 })])
    fakeGrabs([grabEntry({ grab_id: 1, updated_at: ago(10) }), grabEntry({ grab_id: 2, title: 'Heat', updated_at: ago(20) })])
    await openActivity()
    const [one, two] = within(await screen.findByRole('region', { name: 'History' })).getAllByRole('listitem')
    ;(document.activeElement as HTMLElement).blur()

    await userEvent.keyboard('{Enter}')
    expect(await within(one).findByText('What happened')).toBeInTheDocument()
    await userEvent.keyboard('j{Enter}')
    expect(await within(two).findByText('What happened')).toBeInTheDocument()
    expect(within(one).queryByText('What happened')).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(within(two).queryByText('What happened')).not.toBeInTheDocument())
  })

  it('opens a failed row with the exact reason, what is left to do, and Search Now, Manual Search and Remove from Blocklist', async () => {
    const searched: string[] = []
    const scopes: unknown[] = []
    server.use(
      http.post('/versions/{id}/search', async ({ params, request, response }) => {
        searched.push(String(params.id))
        scopes.push(await request.clone().json())
        return response(202).json({ search_id: 'search-1' })
      }),
    )
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 1, episodes: 1, upgrades: 0 },
          pass: null,
          next_pass_at: new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString(),
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    const steps = fakeSteps([stepsOf({ grab_id: 31, grabbed_by: 'by_hand', files: [], formats: [], blocklist_id: 9, still_wanted: true, download_started_at: ago(70), download_finished_at: ago(50) })])
    fakeGrabs([
      grabEntry({
        grab_id: 31,
        state: 'failed',
        failure: 'the file has German audio only',
        title: 'Breaking Bad',
        kind: 'series',
        slot: '4k',
        episodes: ['S05E09'],
        episode_ids: [909],
        version_id: 11,
        blocklist_reason: 'import rejected: x',
      }),
    ])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))

    const timeline = within(await within(item).findByRole('list', { name: 'What happened' }))
    expect(timeline.getAllByRole('listitem')[0]).toHaveTextContent('Grabbed by hand · NZBgeek')
    const last = timeline.getAllByRole('listitem').at(-1)!
    expect(last).toHaveTextContent('Import rejected: the file has German audio only')
    expect(await within(item).findByText(/The release is blocklisted for the 4K Version\. S05E09 is still Wanted in 4K; the next search pass tries again in 3 h/)).toBeInTheDocument()

    await userEvent.click(within(item).getByRole('button', { name: 'Search S05E09 Now' }))
    await waitFor(() => expect(searched).toEqual(['11']))
    expect(scopes).toEqual([{ episode_ids: [909] }])
    await userEvent.click(within(item).getByRole('button', { name: 'Remove from Blocklist' }))
    await waitFor(() => expect(steps.unblocked).toEqual([9]))
    expect(within(item).getByRole('button', { name: 'Manual Search…' })).toBeInTheDocument()
  })

  it('says a failed Grab’s Release is not blocklisted and its Movie no longer Wanted, and offers no Remove from Blocklist', async () => {
    fakeSteps([stepsOf({ grab_id: 31, files: [], formats: [], blocklist_id: null, still_wanted: false })])
    fakeGrabs([grabEntry({ grab_id: 31, state: 'failed', failure: 'download_failed', title: 'Heat' })])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))

    expect(await within(item).findByText('The release is not blocklisted. Heat is no longer Wanted.')).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Search Heat Now' })).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: 'Remove from Blocklist' })).not.toBeInTheDocument()
  })

  it('says in a Toast why Retry now, Discard and Search Now failed, and closes the Discard dialog on confirm', async () => {
    const refuse = (detail: string) => ({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail })
    server.use(
      http.post('/grabs/{id}/retry-import', ({ response }) => response('default').json(refuse('disk offline'), { status: 500 })),
      http.post('/grabs/{id}/discard', ({ response }) => response('default').json(refuse('client offline'), { status: 500 })),
      http.post('/versions/{id}/search', ({ response }) => response('default').json(refuse('the indexer is down'), { status: 500 })),
    )
    fakeSteps([stepsOf({ grab_id: 7, files: [], formats: [] })])
    fakeGrabs([grabEntry({ grab_id: 6, state: 'importing', stalled }), grabEntry({ grab_id: 7, state: 'failed', failure: 'download_failed', version_id: 11, title: 'Heat' })])
    await openActivity()

    const stuck = within(await screen.findByRole('region', { name: 'In progress' })).getByRole('listitem')
    await userEvent.click(within(stuck).getByRole('button', { name: 'More for Paddington' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Retry now' }))
    expect(await findToast('Could not retry the import: disk offline')).toBeInTheDocument()

    await userEvent.click(within(stuck).getByRole('button', { name: 'Discard Paddington' }))
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard this Grab' })).getByRole('button', { name: 'Discard' }))
    expect(await findToast('Could not discard the Grab: client offline')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    const failed = within(screen.getByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(failed).getByRole('button', { expanded: false }))
    await userEvent.click(await within(failed).findByRole('button', { name: 'Search Heat Now' }))
    expect(await findToast('Could not search Heat: the indexer is down')).toBeInTheDocument()
  })

  it('says in the steps why a Release was grabbed and what the Import replaced, from the Grab and not the pruned events', async () => {
    fakeDownloadClient()
    fakeLibrary([row(5, 'Paddington', 'Paddington')])
    fakeSteps([
      stepsOf({
        grab_id: 21,
        grabbed_at: ago(6000),
        download_started_at: ago(5990),
        download_finished_at: ago(5900),
        ended_at: ago(5880),
        files: [
          { episode: 'S05E05', path: '/tv/a.mkv' },
          { episode: 'S05E06', path: '/tv/b.mkv' },
        ],
        why: { covers_wanted: 2, replaces_files: 0, score_delta: 0 },
        replaced: 0,
      }),
    ])
    fakeGrabs([grabEntry({ grab_id: 21, indexer: 'NZBgeek', size: 3.2 * 1024 ** 3, updated_at: ago(5880) })])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))

    const steps = within(await within(item).findByRole('list', { name: 'What happened' })).getAllByRole('listitem')
    expect(steps[0]).toHaveTextContent('Grabbed by the search pass · NZBgeek · covers 2 Wanted')
    expect(steps[1]).toHaveTextContent(/Downloaded in SABnzbd · 3\.2 GB/)
    expect(steps[2]).toHaveTextContent('Imported 2 files · replaced nothing')
  })

  it('counts the files an Import replaced', async () => {
    fakeDownloadClient()
    fakeLibrary([row(5, 'Paddington', 'Paddington')])
    fakeSteps([stepsOf({ grab_id: 21, replaced: 1 })])
    fakeGrabs([grabEntry({ grab_id: 21 })])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))

    const steps = within(await within(item).findByRole('list', { name: 'What happened' })).getAllByRole('listitem')
    expect(steps.at(-1)).toHaveTextContent('Imported 1 file · replaced 1')
  })

  it('opens the Title from an opened imported row', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington'), row(6, 'Heat', 'Heat')])
    fakeSteps([stepsOf({ grab_id: 1 })])
    fakeGrabs([grabEntry({ grab_id: 1, title_id: 5 })])
    await openActivity()

    const item = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    await userEvent.click(within(item).getByRole('button', { expanded: false }))
    await userEvent.click(await within(item).findByRole('button', { name: 'Open Paddington' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()
  })

  it('marks the cursor row with aria-current and moves it, scrolled into view, with j and k', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fakeGrabs([grabEntry({ grab_id: 1, title_id: 5 }), grabEntry({ grab_id: 2, title_id: 6, title: 'Heat', updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() })])
    await openActivity()
    const rows = within(await screen.findByRole('region', { name: 'History' })).getAllByRole('listitem')
    ;(document.activeElement as HTMLElement).blur()
    const current = () => document.querySelector('li[aria-current="true"]')

    expect(current()).toBe(rows[0])
    await userEvent.keyboard('j')
    expect(current()).toBe(rows[1])
    expect(scroll.mock.contexts.at(-1)).toBe(rows[1])
    await userEvent.keyboard('k')
    expect(current()).toBe(rows[0])
  })

  it('shows a running search pass as the first row of In progress: what is searched now, the releases checked and its Progress', async () => {
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 12, episodes: 0, upgrades: 0 },
          pass: passOf({
            done: 3,
            total: 12,
            releases_seen: 40,
            grabbed: 1,
            current: { title_id: 7, title: 'Breaking Bad', has_poster: false, slot: '4K', season: 5, episodes: [], releases_seen: 12 },
          }),
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    fakeQueue([queueItem({ grab_id: 1 })])
    await openActivity()

    const region = await screen.findByRole('region', { name: 'In progress' })
    const pass = within(region).getByRole('listitem', { name: 'Search pass' })
    expect(pass).toHaveTextContent('Searching Wanted · now Breaking Bad S05 · 4K')
    expect(pass).toHaveTextContent('40 releases checked · 1 Grab so far')
    expect(pass).toHaveTextContent('3 of 12')
    expect(within(pass).getByRole('progressbar', { name: 'Search progress' })).toBeInTheDocument()
    expect(within(region).getAllByRole('listitem')[0]).toBe(pass)
    expect(screen.getByRole('heading', { name: /^In progress/ })).toHaveTextContent('In progress 2')
    expect(within(screen.getByRole('navigation', { name: 'Views' })).getByRole('button', { name: /^In progress/ })).toHaveTextContent('2')

    // A pass cannot be narrowed to a kind, Slot or text.
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter Activity' }), 'kind:series ')
    expect(screen.queryByRole('listitem', { name: 'Search pass' })).not.toBeInTheDocument()
  })

  it('shows no search row between passes', async () => {
    fakeQueue([queueItem({ grab_id: 1 })])
    await openActivity()

    await screen.findByRole('region', { name: 'In progress' })
    expect(screen.queryByRole('listitem', { name: 'Search pass' })).not.toBeInTheDocument()
  })

  it('lists a Release canceled and blocklisted, which leaves no Grab, in History as Failed', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington', { has_poster: true })])
    fakeGrabs([], [blockedEntry({ title_id: 5 }), blockedEntry({ id: 8, release_name: 'Old.Release-GRP', created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() })])
    await openActivity()

    const items = within(await screen.findByRole('region', { name: 'History' })).getAllByRole('listitem') // the older one too: there is no 7-day cap
    expect(items).toHaveLength(2)
    const li = items[0]
    expect(li).toHaveTextContent('Paddington')
    expect(li).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-BAD')
    expect(li).toHaveTextContent('Failed · canceled and blocklisted')
    expect(li.querySelector('[data-poster] img')).toHaveAttribute('src', expect.stringMatching(/\/titles\/5\/poster$/))
  })

  it('reserves a poster box in each loading row', async () => {
    server.use(http.get('/queue', () => new Promise(() => {})))
    await openActivity()

    const region = await screen.findByRole('region', { name: 'Loading' })
    expect(region.querySelectorAll('[style*="width: 40px"][style*="height: 60px"]')).toHaveLength(3)
  })

  it('follows the stream: a Grab moves on as the queue frames say', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeQueue([queueItem({ grab_id: 1, phase: 'queued' })])
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    const region = await screen.findByRole('region', { name: 'In progress' })
    expect(within(region).getByRole('listitem')).toHaveTextContent('Queued')

    act(() => client.setQueryData(['queue'], [queueItem({ grab_id: 1, phase: 'downloading' })]))

    await waitFor(() => expect(within(screen.getByRole('region', { name: 'In progress' })).getByRole('listitem')).toHaveTextContent('Downloading'))
    act(() => client.setQueryData(['queue'], []))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument())
  })
})

describe('Activity on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    history.replaceState(null, '', '/activity')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens its Filter menu with the Views, with counts, and no badge for them', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' })])
    fakeGrabs([grabEntry({ grab_id: 2, state: 'imported' }), grabEntry({ grab_id: 3, state: 'failed' })])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Views and filter' }))
    const failed = await screen.findByRole('menuitemcheckbox', { name: /^Failed/ })
    await waitFor(() => expect(failed).toHaveTextContent('1'))
    expect(screen.getByRole('menuitemcheckbox', { name: /^Everything/ })).toHaveAttribute('aria-checked', 'true')
    expect(
      screen
        .getAllByRole('menuitemcheckbox')
        .map((m) => m.textContent?.replace(/[\d,\s]+$/, ''))
        .slice(0, 4),
    ).toEqual(['Everything', 'In progress', 'Imported', 'Failed'])
    await userEvent.click(failed)
    expect(screen.getByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:failed')
    expect(screen.queryByRole('button', { name: /active/ })).not.toBeInTheDocument()
  })

  it('shows a History row as two lines with its result and time, and a tap opens it', async () => {
    fakeSteps([stepsOf({ grab_id: 31, files: [], formats: [], blocklist_id: null })])
    fakeGrabs([
      grabEntry({ grab_id: 31, state: 'failed', failure: 'download_failed', title: 'Heat', updated_at: ago(5) }),
      grabEntry({ grab_id: 30, title: 'Paddington', size: 8 * 1024 ** 3, updated_at: ago(30) }),
    ])
    renderApp()

    const [failed, imported] = within(await screen.findByRole('region', { name: 'History' })).getAllByRole('listitem')
    expect(failed).toHaveTextContent('Failed · the download failed')
    expect(imported).toHaveTextContent('Imported · 8.0 GB')
    expect(failed).toHaveTextContent(/\d{1,2}:\d{2}/)
    await userEvent.click(within(failed).getByRole('button', { expanded: false }))
    expect(await within(failed).findByText('What happened')).toBeInTheDocument()
    expect(within(failed).getByRole('button', { name: 'Search Heat Now' })).toBeInTheDocument()
  })

  it('opens a History row from the keyboard, and its button is named by the row', async () => {
    fakeSteps([stepsOf({ grab_id: 30, files: [], formats: [], blocklist_id: null })])
    fakeGrabs([grabEntry({ grab_id: 30, title: 'Paddington', updated_at: ago(30) })])
    renderApp()

    const row = within(await screen.findByRole('region', { name: 'History' })).getByRole('listitem')
    const toggle = within(row).getByRole('button', { name: /Paddington/ })
    toggle.focus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await within(row).findByText('What happened')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a live row with a tap onto Cancel, Cancel and Blocklist and Open Title', async () => {
    fakeQueue([queueItem({ grab_id: 1 })])
    renderApp()

    const live = within(await screen.findByRole('region', { name: 'In progress' })).getByRole('listitem')
    expect(within(live).queryByRole('button', { name: 'Cancel and Blocklist' })).not.toBeInTheDocument()
    await userEvent.click(within(live).getByRole('button', { name: /Paddington.2014.1080p.BluRay.x264-GRP/, expanded: false }))
    expect(within(live).getByRole('button', { name: 'Cancel and Blocklist' })).toBeInTheDocument()
    expect(within(live).getByRole('button', { name: 'Open Paddington' })).toBeInTheDocument()
  })
})

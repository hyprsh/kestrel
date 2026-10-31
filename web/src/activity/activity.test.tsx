import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { blockedEntry, fakeGrabs, grabEntry } from '../test/grabs'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openActivity() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
}

const stalled = { reason: 'disk full', since: new Date(Date.now() - 20 * 60_000).toISOString(), next_at: new Date(Date.now() + 5 * 60_000).toISOString() }

describe('Activity', () => {
  it('shows every Grab in one list grouped by stage, each heading with its count', async () => {
    fakeQueue([
      queueItem({ grab_id: 1, phase: 'queued', release_name: 'A.Queued-GRP' }),
      queueItem({ grab_id: 2, phase: 'paused', release_name: 'B.Paused-GRP' }),
      queueItem({ grab_id: 3, phase: 'downloading', release_name: 'C.Downloading-GRP' }),
      queueItem({ grab_id: 4, phase: 'post_processing', release_name: 'D.Processing-GRP' }),
      queueItem({ grab_id: 5, phase: 'importing', release_name: 'E.Importing-GRP' }),
    ])
    fakeGrabs([
      grabEntry({ grab_id: 6, state: 'importing', stalled, release_name: 'F.Stalled-GRP' }),
      grabEntry({ grab_id: 7, state: 'imported', release_name: 'G.Imported-GRP' }),
      grabEntry({ grab_id: 8, state: 'failed', failure: 'download_failed', release_name: 'H.Failed-GRP' }),
    ])
    await openActivity()

    const stage = async (name: string) =>
      within(await screen.findByRole('region', { name }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    expect(await stage('Queued · 2')).toEqual([expect.stringContaining('A.Queued-GRP'), expect.stringContaining('B.Paused-GRP')])
    expect(await stage('Downloading · 1')).toEqual([expect.stringContaining('C.Downloading-GRP')])
    expect(await stage('Post-processing · 1')).toEqual([expect.stringContaining('D.Processing-GRP')])
    expect(await stage('Importing · 1')).toEqual([expect.stringContaining('E.Importing-GRP')])
    expect(await stage('Stalled · 1')).toEqual([expect.stringContaining('F.Stalled-GRP')])
    expect(await stage('Done · 1')).toEqual([expect.stringContaining('G.Imported-GRP')])
    expect(await stage('Failed · 1')).toEqual([expect.stringContaining('H.Failed-GRP')])
  })

  it('reads Done and Failed for the last 7 days and points to the Log for older ones', async () => {
    const grabs = fakeGrabs([grabEntry()])
    await openActivity()

    await screen.findByRole('region', { name: 'Done · 1' })
    const finished = grabs.queries.find((q) => q.getAll('state').length > 0)!
    expect(finished.getAll('state')).toEqual(['imported', 'failed'])
    const days = (Date.now() - Date.parse(finished.get('since')!)) / 86_400_000
    expect(days).toBeCloseTo(7, 1)
    expect(grabs.queries.some((q) => q.get('stalled') === 'true')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Older ones are in the Log' }))
    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:grabs,imports')
  })

  it('names the indexer, Score, size, speed, when it was grabbed and how long it has been in its stage', async () => {
    const min = 60_000
    fakeQueue([
      queueItem({
        phase: 'downloading',
        indexer: 'NZBgeek',
        score: 1450,
        size: 8 * 1024 ** 3,
        bytes_left: 600 * 1024 ** 2,
        eta: 60,
        grabbed_at: new Date(Date.now() - 50 * min).toISOString(),
        phase_since: new Date(Date.now() - 20 * min).toISOString(),
      }),
    ])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'Downloading · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('NZBgeek · Score 1450 · 8.0 GB · 10 MB/s · grabbed 50 min ago · in this stage for 20 min')
    expect(within(row).getByRole('progressbar')).toBeInTheDocument()
    expect(row).toHaveTextContent('1 min left')
  })

  it('tells the times of a fresh Grab in one vocabulary, so grabbed and in-stage agree', async () => {
    const now = new Date(Date.now() - 58_000).toISOString()
    fakeQueue([queueItem({ phase: 'downloading', indexer: 'NZBgeek', grabbed_at: now, phase_since: now })])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'Downloading · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('grabbed just now · in this stage for under a minute')
  })

  it('filters to one or more stages with the Stage menu, each row with its count, and keeps them in the address bar', async () => {
    fakeQueue([queueItem({ grab_id: 1, phase: 'downloading' })])
    fakeGrabs([grabEntry({ grab_id: 7, state: 'imported' }), grabEntry({ grab_id: 8, state: 'failed', failure: 'download_failed' })])
    await openActivity()

    await screen.findByRole('region', { name: 'Done · 1' })
    await userEvent.click(screen.getByRole('button', { name: /^Stage/ }))
    const stage = (name: string) => screen.getByRole('option', { name })
    expect(stage('Downloading')).toHaveTextContent('1')
    expect(stage('Downloading')).toHaveAttribute('aria-selected', 'false')
    expect(stage('Stalled')).toHaveTextContent('0')

    await userEvent.click(stage('Done'))
    expect(stage('Done')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Done · 1' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Downloading · 1' })).not.toBeInTheDocument()
    expect(location.pathname + location.search).toBe('/activity?q=stage%3Adone')

    await userEvent.click(stage('Failed'))
    expect(screen.getByRole('combobox', { name: 'Filter Activity' })).toHaveValue('stage:done,failed')
    expect(screen.getByRole('region', { name: 'Failed · 1' })).toBeInTheDocument()

    await userEvent.click(stage('Done'))
    await userEvent.click(stage('Failed'))
    expect(screen.getByRole('combobox', { name: 'Filter Activity' })).toHaveValue('')
    expect(screen.getByRole('region', { name: 'Downloading · 1' })).toBeInTheDocument()
  })

  it('opens on one Grab from its address with grab:<id>, in whatever stage it is in, and clearing the filter shows the pipeline', async () => {
    history.replaceState(null, '', '/activity?q=grab:42')
    fakeQueue([queueItem({ grab_id: 41, phase: 'downloading', release_name: 'Other.Downloading-GRP' })])
    fakeGrabs([
      grabEntry({ grab_id: 42, state: 'failed', failure: 'download_failed', release_name: 'Mine.Failed-GRP' }),
      grabEntry({ grab_id: 43, state: 'imported', release_name: 'Other.Imported-GRP' }),
    ])
    renderApp()

    const row = within(await screen.findByRole('region', { name: 'Failed · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('Mine.Failed-GRP')
    expect(screen.queryByText('Other.Downloading-GRP')).not.toBeInTheDocument()
    expect(screen.queryByText('Other.Imported-GRP')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByRole('combobox', { name: 'Filter Activity' }))
    expect(await screen.findByText('Other.Downloading-GRP')).toBeInTheDocument()
    expect(screen.getByText('Other.Imported-GRP')).toBeInTheDocument()
  })

  it('shows the no-match state for a grab: id that matches nothing', async () => {
    history.replaceState(null, '', '/activity?q=grab:999')
    fakeQueue([queueItem({ grab_id: 41, phase: 'downloading', release_name: 'Other.Downloading-GRP' })])
    fakeGrabs([])
    renderApp()

    await screen.findByRole('combobox', { name: 'Filter Activity' })
    await waitFor(() => expect(screen.queryByText('Other.Downloading-GRP')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: /^Downloading/ })).not.toBeInTheDocument()
    expect(screen.getByText('Nothing in Activity matches.')).toBeInTheDocument()
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

    expect(await screen.findByRole('region', { name: 'Done · 1' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Downloading/ })).not.toBeInTheDocument()
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
      within(screen.getByRole('region', { name: /^Downloading/ }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)

    await userEvent.type(field, 'kind:movie ')
    expect(shown()).toEqual([expect.stringContaining('Paddington'), expect.stringContaining('Heat')])
    await userEvent.type(field, 'slot:4k ')
    expect(shown()).toEqual([expect.stringContaining('Heat')])
    await userEvent.clear(field)
    await userEvent.type(field, 'drunkenslug')
    expect(shown()).toEqual([expect.stringContaining('Heat')])
    expect(screen.getByRole('region', { name: 'Downloading · 1' })).toBeInTheDocument()
  })

  it('cancels an active Grab, with or without blocklisting it', async () => {
    const queue = fakeQueue([queueItem({ grab_id: 1 }), queueItem({ grab_id: 2, release_name: 'Other-GRP' })])
    await openActivity()

    const region = await screen.findByRole('region', { name: 'Downloading · 2' })
    const [first, second] = within(region).getAllByRole('listitem')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(second).getByRole('button', { name: 'Cancel and blocklist' }))

    await waitFor(() =>
      expect(queue.cancels).toEqual([
        { id: '1', body: { blocklist: false } },
        { id: '2', body: { blocklist: true } },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Downloading/ })).not.toBeInTheDocument())
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

    const row = within(await screen.findByRole('region', { name: 'Stalled · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('Import stalled for 20 min: disk full · tried again in 5 min')
    await userEvent.click(within(row).getByRole('button', { name: 'Retry now' }))
    await waitFor(() => expect(sent).toEqual(['retry 6']))
    await userEvent.click(within(row).getByRole('button', { name: 'Discard' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this Grab' })
    expect(dialog).toHaveTextContent('Its downloaded files are deleted and the Version is searched for again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(sent).toEqual(['retry 6'])
    await userEvent.click(within(row).getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard this Grab' })).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(sent).toEqual(['retry 6', 'discard 6']))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('searches a failed Grab’s Version again', async () => {
    const searched: string[] = []
    server.use(http.post('/versions/{id}/search', ({ params, response }) => (searched.push(String(params.id)), response(202).empty())))
    fakeGrabs([grabEntry({ state: 'failed', failure: 'download_failed', version_id: 11 }), grabEntry({ grab_id: 22, state: 'imported' })])
    await openActivity()

    expect(within(await screen.findByRole('region', { name: 'Done · 1' })).queryByRole('button', { name: 'Search again' })).not.toBeInTheDocument()
    const row = within(screen.getByRole('region', { name: 'Failed · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('Failed 1 h ago: the download failed')
    await userEvent.click(within(row).getByRole('button', { name: 'Search again' }))

    await waitFor(() => expect(searched).toEqual(['11']))
    expect(within(row).getByRole('button', { name: 'Searching…' })).toBeDisabled()
  })

  it('says in a Toast why Retry now, Discard and Search again failed, and closes the Discard dialog on confirm', async () => {
    const refuse = (detail: string) => ({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail })
    server.use(
      http.post('/grabs/{id}/retry-import', ({ response }) => response('default').json(refuse('disk offline'), { status: 500 })),
      http.post('/grabs/{id}/discard', ({ response }) => response('default').json(refuse('client offline'), { status: 500 })),
      http.post('/versions/{id}/search', ({ response }) => response('default').json(refuse('the indexer is down'), { status: 500 })),
    )
    fakeGrabs([grabEntry({ grab_id: 6, state: 'importing', stalled }), grabEntry({ grab_id: 7, state: 'failed', failure: 'download_failed', version_id: 11, title: 'Heat' })])
    await openActivity()

    const stuck = within(await screen.findByRole('region', { name: 'Stalled · 1' })).getByRole('listitem')
    await userEvent.click(within(stuck).getByRole('button', { name: 'Retry now' }))
    expect(await findToast('Could not retry the import: disk offline')).toBeInTheDocument()

    await userEvent.click(within(stuck).getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard this Grab' })).getByRole('button', { name: 'Discard' }))
    expect(await findToast('Could not discard the Grab: client offline')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    const failed = within(screen.getByRole('region', { name: 'Failed · 1' })).getByRole('listitem')
    await userEvent.click(within(failed).getByRole('button', { name: 'Search again' }))
    expect(await findToast('Could not search Heat: the indexer is down')).toBeInTheDocument()
  })

  it('opens the Title from its name, and the selected row’s Title with Enter', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington'), row(6, 'Heat', 'Heat')])
    fakeGrabs([grabEntry({ grab_id: 1, title_id: 5 }), grabEntry({ grab_id: 2, title_id: 6, title: 'Heat', updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() })])
    await openActivity()

    const region = await screen.findByRole('region', { name: 'Done · 2' })
    await userEvent.click(within(region).getByRole('button', { name: 'Paddington' }))
    expect(await screen.findByRole('region', { name: /paddington/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Activity' }))
    await screen.findByRole('region', { name: 'Done · 2' })
    ;(document.activeElement as HTMLElement).blur() // Enter on the focused rail button is the button's
    await userEvent.keyboard('j')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: /heat/i })).toBeInTheDocument()
  })

  it('marks the cursor row with aria-current and moves it, scrolled into view, with j and k', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fakeLibrary([row(5, 'Paddington', 'Paddington'), row(6, 'Heat', 'Heat')])
    fakeGrabs([grabEntry({ grab_id: 1, title_id: 5 }), grabEntry({ grab_id: 2, title_id: 6, title: 'Heat', updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() })])
    await openActivity()
    const rows = within(await screen.findByRole('region', { name: 'Done · 2' })).getAllByRole('listitem')
    ;(document.activeElement as HTMLElement).blur()
    const current = () => document.querySelector('[aria-current="true"]')

    expect(current()).toBe(rows[0])
    await userEvent.keyboard('j')
    expect(current()).toBe(rows[1])
    expect(scroll.mock.contexts.at(-1)).toBe(rows[1])
    await userEvent.keyboard('k')
    expect(current()).toBe(rows[0])
  })

  it('shows what waits for a search or is being searched as the Searching stage', async () => {
    server.use(
      http.get('/search/status', ({ response }) =>
        response(200).json({
          due: { versions: 12, episodes: 0, upgrades: 0 },
          pass: { started_at: new Date().toISOString(), done: 3, total: 12 },
          next_pass_at: null,
          last_pass: null,
          upgrades_per_pass: 5,
          indexers: [],
        }),
      ),
    )
    await openActivity()

    const region = await screen.findByRole('region', { name: 'Searching · 12' })
    expect(region).toHaveTextContent('12 Wanted waiting · searching 3 of 12')
    await userEvent.click(screen.getByRole('button', { name: /^Stage/ }))
    expect(screen.getByRole('option', { name: 'Searching' })).toHaveTextContent('12')
    await userEvent.keyboard('{Escape}')

    // A summary cannot be narrowed to a kind, Slot or text.
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter Activity' }), 'kind:series ')
    expect(screen.queryByRole('region', { name: /^Searching/ })).not.toBeInTheDocument()
  })

  it('lists a Release canceled and blocklisted, which leaves no Grab, under Failed', async () => {
    fakeLibrary([row(5, 'Paddington', 'Paddington', { has_poster: true })])
    fakeGrabs([], [blockedEntry({ title_id: 5 }), blockedEntry({ id: 8, release_name: 'Old.Release-GRP', created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() })])
    await openActivity()

    const li = within(await screen.findByRole('region', { name: 'Failed · 1' })).getByRole('listitem')
    expect(li).toHaveTextContent('Paddington')
    expect(li).toHaveTextContent('Paddington.2014.1080p.BluRay.x264-BAD')
    expect(li).toHaveTextContent('Blocklisted 10 min ago: canceled and blocklisted')
    expect(li.querySelector('[data-poster] img')).toHaveAttribute('src', expect.stringMatching(/\/titles\/5\/poster$/))
  })

  it('follows the stream: a Grab moves on as the queue frames say', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeQueue([queueItem({ grab_id: 1, phase: 'queued' })])
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    await screen.findByRole('region', { name: 'Queued · 1' })

    act(() => client.setQueryData(['queue'], [queueItem({ grab_id: 1, phase: 'downloading' })]))

    expect(await screen.findByRole('region', { name: 'Downloading · 1' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Queued/ })).not.toBeInTheDocument()
  })

  it('says why a Grab failed and that its Release went on the Blocklist', async () => {
    fakeGrabs([grabEntry({ state: 'failed', failure: 'language', blocklist_reason: 'import rejected: language', updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() })])
    await openActivity()

    const row = within(await screen.findByRole('region', { name: 'Failed · 1' })).getByRole('listitem')
    expect(row).toHaveTextContent('Failed 2 h ago: language · Blocklisted: import rejected: language')
  })
})

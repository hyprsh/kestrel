import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Row = components['schemas']['AttentionRow']
type Status = components['schemas']['SystemStatus']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const subject = { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null }

const sabRow = (over: Partial<Row> = {}): Row => ({
  id: 'health-1',
  severity: 'blocking',
  kind: 'download_client_unreachable',
  subject: { ...subject, plugin_instance_id: 3 },
  message: 'SABnzbd is unreachable: connection refused',
  since: '2026-10-18T09:00:00Z',
  count: 1,
  actions: [
    { key: 'test', label: 'Test', method: 'POST', path: '/plugin-instances/3/test', body: null, confirm: null },
    { key: 'open', label: 'Open in Settings', method: 'GET', path: '/settings/download-client', body: null, confirm: null },
  ],
  ...over,
})

const exdevRow = (over: Partial<Row> = {}): Row => ({
  id: 'health-2',
  severity: 'warning',
  kind: 'exdev',
  subject,
  message: 'Imports into /data/media/movies copy instead of moving',
  since: '2026-10-18T09:30:00Z',
  count: 2,
  actions: [{ key: 'dismiss', label: 'Dismiss', method: 'POST', path: '/attention/health-2/dismiss', body: null, confirm: null }],
  ...over,
})

function fakeAttention(rows: Row[]) {
  const state = {
    rows,
    calls: [] as string[],
    bodies: [] as unknown[],
    // What a Test answers; a passing one clears the row it was run from, as the server does.
    clears: true,
    test: { ok: false, code: 'unavailable', message: 'SABnzbd did not answer' } as { ok: boolean; code: string | null; message: string },
  }
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({
        count: state.rows.length,
        severity: state.rows.length === 0 ? null : state.rows[0].severity,
        rows: state.rows,
        long_missing: { count: 0, items: [] },
        originals: { count: 0, items: [] },
      }),
    ),
    http.post('/attention/{id}/dismiss', ({ params, response }) => {
      state.calls.push(`POST dismiss ${params.id}`)
      state.rows = state.rows.filter((r) => r.id !== params.id)
      return response(204).empty()
    }),
    http.post('/plugin-instances/{id}/test', ({ params, response }) => {
      state.calls.push(`POST test ${params.id}`)
      if (state.test.ok && state.clears) state.rows = state.rows.filter((r) => !r.actions.some((a) => a.path === `/plugin-instances/${params.id}/test`))
      return response(200).json(state.test)
    }),
    http.patch('/plugin-instances/{id}', async ({ params, request, response }) => {
      state.calls.push(`PATCH instance ${params.id}`)
      state.bodies.push(await request.clone().json())
      return response(200).json({
        id: Number(params.id),
        contract: 'indexer.v1',
        plugin_id: 'newznab',
        name: 'Alpha',
        enabled: false,
        priority: 1,
        config: {},
        secrets_set: [],
        from_config_file: false,
        enabled_declared: false,
        last_check: null,
      })
    }),
  )
  return state
}

const sectionOf = async (name: RegExp) => screen.findByRole('region', { name })

describe('Needs attention', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists the rows in the order the server sent them, Blocking first, with their messages', async () => {
    fakeAttention([sabRow(), exdevRow()])
    renderApp()

    const section = await sectionOf(/needs attention/i)
    const rows = await within(section).findAllByRole('listitem')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('SABnzbd is unreachable: connection refused')
    expect(rows[0]).toHaveTextContent(/blocking/i)
    expect(rows[1]).toHaveTextContent('Imports into /data/media/movies copy instead of moving')
    expect(rows[1]).toHaveTextContent(/warning/i)
  })

  it('says so when nothing needs attention', async () => {
    fakeAttention([])
    renderApp()

    const section = await sectionOf(/needs attention/i)

    expect(await within(section).findByText(/nothing needs attention/i)).toBeInTheDocument()
    expect(within(section).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shows five rows with the count in the heading, and expands in place to the rest', async () => {
    const warnings = Array.from({ length: 7 }, (_, i) => exdevRow({ id: `w${i + 1}`, message: `Warning ${i + 1}` }))
    fakeAttention(warnings)
    renderApp()

    await screen.findByText('Warning 1')
    const section = screen.getByRole('region', { name: 'Needs attention · 7' })
    const messages = () =>
      within(section)
        .getAllByRole('listitem')
        .map((r) => r.textContent)
    expect(messages()).toEqual([1, 2, 3, 4, 5].map((n) => expect.stringContaining(`Warning ${n}`)))

    const more = within(section).getByRole('button', { name: 'View all 7' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(messages()).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => expect.stringContaining(`Warning ${n}`)))

    await userEvent.click(within(section).getByRole('button', { name: 'Show fewer' }))
    expect(messages()).toHaveLength(5)
  })

  it('always shows every Blocking row, even beyond five', async () => {
    const blocking = Array.from({ length: 6 }, (_, i) => sabRow({ id: `b${i + 1}`, message: `Blocking ${i + 1}` }))
    fakeAttention([...blocking, exdevRow({ message: 'A warning' })])
    renderApp()

    const section = await screen.findByRole('region', { name: 'Needs attention · 7' })
    const messages = within(section)
      .getAllByRole('listitem')
      .map((r) => r.textContent)
    expect(messages).toEqual([1, 2, 3, 4, 5, 6].map((n) => expect.stringContaining(`Blocking ${n}`)))
    expect(within(section).getByRole('button', { name: 'View all 7' })).toBeInTheDocument()
  })

  it('has no "View all" when every row is showing', async () => {
    fakeAttention([sabRow(), exdevRow()])
    renderApp()

    const section = await screen.findByRole('region', { name: 'Needs attention · 2' })
    expect(within(section).queryByRole('button', { name: /view all/i })).not.toBeInTheDocument()
  })

  it('draws whatever actions the server built, the first as a button and the rest in a menu, whatever the kind of row', async () => {
    fakeAttention([
      exdevRow({
        kind: 'a_kind_the_spa_has_never_heard_of',
        actions: [
          { key: 'frobnicate', label: 'Frobnicate', method: 'POST', path: '/attention/health-2/dismiss', body: null, confirm: null },
          { key: 'peek', label: 'Take a look', method: 'GET', path: '/settings/indexers', body: null, confirm: null },
        ],
      }),
    ])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')

    expect(within(row).getByRole('button', { name: 'Frobnicate' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Take a look' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'More Actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Take a look' })).toBeInTheDocument()
  })

  it('has no menu when a row has one action', async () => {
    fakeAttention([exdevRow()])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')

    expect(within(row).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'More Actions' })).not.toBeInTheDocument()
  })

  it('runs an API action from the row and shows what came back', async () => {
    const state = fakeAttention([sabRow()])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Test' }))

    expect(await within(row).findByText('Test failed: SABnzbd did not answer')).toBeInTheDocument()
    expect(state.calls).toEqual(['POST test 3'])
  })

  it('says a failing Test failed, in an error note with the message', async () => {
    fakeAttention([sabRow()])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Test' }))

    expect(await within(row).findByRole('alert')).toHaveTextContent('Test failed: SABnzbd did not answer')
    expect(within(row).getByText(/blocking/i)).toBeInTheDocument()
  })

  it('acknowledges a passing Test with a toast, and the row it cleared goes', async () => {
    const state = fakeAttention([sabRow(), exdevRow()])
    state.test = { ok: true, code: null, message: 'SABnzbd 4.5.1' }
    renderApp()

    const section = await sectionOf(/needs attention/i)
    const row = (await within(section).findAllByRole('listitem'))[0]
    await userEvent.click(within(row).getByRole('button', { name: 'Test' }))

    expect(await screen.findByText('Test passed: SABnzbd 4.5.1')).toBeInTheDocument()
    expect(screen.queryByText('SABnzbd is unreachable: connection refused')).not.toBeInTheDocument()
  })

  it('sends the body an action carries', async () => {
    const state = fakeAttention([
      sabRow({
        kind: 'indexer_failing',
        severity: 'warning',
        message: 'Alpha rejected its credentials',
        actions: [{ key: 'disable', label: 'Disable', method: 'PATCH', path: '/plugin-instances/11', body: { enabled: false }, confirm: null }],
      }),
    ])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Disable' }))

    await vi.waitFor(() => expect(state.calls).toEqual(['PATCH instance 11']))
    expect(state.bodies).toEqual([{ enabled: false }])
  })

  it('opens Settings at the section when the action is a GET', async () => {
    fakeAttention([sabRow()])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'More Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open in Settings' }))

    expect(await screen.findByRole('region', { name: 'Download client' })).toBeInTheDocument()
  })

  it('opens the Log filtered to a row', async () => {
    const log = { key: 'log', label: 'Show in the Log', method: 'GET' as const, path: '/log?q=kind:health_raised,health_cleared', body: null, confirm: null }
    fakeAttention([sabRow({ actions: [log] })])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Show in the Log' }))

    expect(await screen.findByRole('combobox', { name: 'Filter the Log' })).toHaveValue('kind:health_raised,health_cleared')
  })

  it('dismisses a one-off warning and the row goes away', async () => {
    const state = fakeAttention([exdevRow()])
    renderApp()

    const section = await sectionOf(/needs attention/i)
    await userEvent.click(await within(section).findByRole('button', { name: 'Dismiss' }))

    expect(await within(section).findByText(/nothing needs attention/i)).toBeInTheDocument()
    expect(state.calls).toEqual(['POST dismiss health-2'])
  })

  const confirmRow = () => exdevRow({ actions: [{ key: 'dismiss', label: 'Dismiss', method: 'POST', path: '/attention/health-2/dismiss', body: null, confirm: 'Hide this warning?' }] })

  it('asks in a dialog before an action that wants confirmation, and does nothing when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const state = fakeAttention([confirmRow()])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Hide this warning?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(state.calls).toEqual([])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('runs the action once the dialog is confirmed', async () => {
    const state = fakeAttention([confirmRow()])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))

    await vi.waitFor(() => expect(state.calls).toEqual(['POST dismiss health-2']))
    expect(await screen.findByText(/nothing needs attention/i)).toBeInTheDocument()
  })

  it('counts the rows on the rail, red while any is Blocking', async () => {
    fakeAttention([sabRow(), exdevRow()])
    renderApp()

    const button = await screen.findByRole('button', { name: /overview.*2 need attention, 1 blocking/i })

    expect(within(button).getByText('2')).toBeInTheDocument()
  })

  it('shows an amber badge when only Warnings are left, and none when there is nothing', async () => {
    const state = fakeAttention([exdevRow()])
    renderApp()

    const button = await screen.findByRole('button', { name: /overview.*1 needs? attention/i })
    expect(button).not.toHaveAccessibleName(/blocking/)
    expect(within(button).getByText('1')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(state.rows).toHaveLength(0)
  })
})

const idle = {
  search_used: 0,
  search_max: null,
  grab_used: null,
  grab_max: null,
  search_paused_until: null,
  grabs_paused: false,
  grabs_paused_until: null,
}

const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [
    { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle },
    { instance_id: 12, name: 'Beta', state: 'failing', message: 'API key rejected', ...idle },
  ],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 }],
  trash: { commit: 'abc1234def', committed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), checked_at: null, auto_update: true },
  grabs_paused: false,
  ...over,
})

describe('The health strip', () => {
  it('shows SABnzbd, each indexer and the free disk space', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status())))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/SABnzbd/)).toBeInTheDocument()
    expect(strip).toHaveTextContent(/SABnzbd.*ok/i)
    expect(strip).toHaveTextContent(/Alpha.*ok/i)
    expect(strip).toHaveTextContent(/Beta.*failing/i)
    expect(strip).toHaveTextContent('/data')
    expect(strip).toHaveTextContent('800 GB free of 1 TB')
  })

  it('shows how old the TRaSH snapshot is', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status())))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/3 days old/)).toBeInTheDocument()
    expect(strip).toHaveTextContent(/TRaSH.*3 days old/)
  })

  it("shows each indexer's daily budget and any pause, which are not failures", async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json(
          status({
            indexers: [
              { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle, search_used: 42, search_max: 100 },
              {
                instance_id: 12,
                name: 'Beta',
                state: 'ok',
                message: null,
                ...idle,
                search_used: 7,
                search_paused_until: '2026-10-18T14:05:00Z',
                grabs_paused: true,
                grabs_paused_until: '2026-10-18T14:05:00Z',
              },
              { instance_id: 13, name: 'Gamma', state: 'ok', message: null, ...idle, grab_used: 5, grab_max: 5, grabs_paused: true },
            ],
          }),
        ),
      ),
    )
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/42 of 100 searches today/)).toBeInTheDocument()
    expect(strip).toHaveTextContent(/Beta.*7 searches today/)
    expect(strip).toHaveTextContent(/Beta.*Searches paused until/)
    expect(strip).toHaveTextContent(/Beta.*Grabs paused until/)
    expect(strip).toHaveTextContent(/Gamma.*Grabs paused \(5 of 5 downloads used\)/)
    expect(strip).not.toHaveTextContent(/failing/)
  })

  it('says when Pause Grabs is on', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status({ grabs_paused: true }))))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/automatic Grabs are paused/i)).toBeInTheDocument()
  })

  it('says nothing about pausing while grabs run', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status())))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    await within(strip).findByText(/SABnzbd/)
    expect(strip).not.toHaveTextContent(/automatic Grabs are paused/i)
  })

  it('says when no download client is set up', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status({ download_client: { state: 'none', name: null, instance_id: null, message: null }, indexers: [] }))))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/no download client/i)).toBeInTheDocument()
  })
  it('says how many items fail in the heading', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status())))
    renderApp()
    expect(await screen.findByRole('region', { name: 'Health · 1 failing' })).toBeInTheDocument()
  })

  it('says "all good" in the heading when nothing fails', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status({ indexers: [] }))))
    renderApp()
    expect(await screen.findByRole('region', { name: 'Health · all good' })).toBeInTheDocument()
  })

  it('draws one tile per item with the state as text, a failing one first', async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json(
          status({
            indexers: [
              { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle },
              { instance_id: 12, name: 'Beta', state: 'failing', message: 'API key rejected', ...idle },
            ],
          }),
        ),
      ),
    )
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })
    await within(strip).findByText('Beta')
    const tiles = within(strip).getAllByRole('listitem')
    expect(tiles.map((t) => t.querySelector('span')?.textContent)).toEqual(['SABnzbd', 'Beta', 'Alpha', '/data', 'TRaSH'])
    expect(tiles[1]).toHaveTextContent('failing')
    expect(tiles[1]).toHaveTextContent('API key rejected')
    expect(tiles[2]).toHaveTextContent('ok')
    for (const group of ['Download client', 'Indexers', 'Disks', 'Other']) expect(within(strip).getByRole('heading', { name: group })).toBeInTheDocument()
  })

  it('draws the search budget and the disk as meters, amber when paused or low', async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json(
          status({
            indexers: [
              { instance_id: 11, name: 'Alpha', state: 'ok', message: null, ...idle, search_used: 42, search_max: 100 },
              { instance_id: 12, name: 'Beta', state: 'ok', message: null, ...idle, search_used: 100, search_max: 100, search_paused_until: '2026-10-18T14:05:00Z' },
            ],
            disks: [
              { path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 },
              { path: '/media', free_bytes: 30 * 2 ** 30, total_bytes: 2 ** 40, low_free_bytes: 50 * 2 ** 30 },
            ],
          }),
        ),
      ),
    )
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })
    const alpha = await within(strip).findByRole('progressbar', { name: 'Alpha searches used today' })
    expect(alpha).toHaveAttribute('aria-valuenow', '42')
    expect(alpha).toHaveAttribute('aria-valuemax', '100')
    expect(within(strip).getByRole('progressbar', { name: '/data space used' })).toBeInTheDocument()
    expect(within(strip).getByRole('progressbar', { name: '/media space used' })).toBeInTheDocument()

    const tile = (name: string) => within(strip).getByText(name).closest('li')!
    expect(tile('Beta')).toHaveTextContent('paused')
    expect(within(tile('Beta')).getByTitle('paused')).toBeInTheDocument()
    expect(within(tile('/data')).getByTitle('ok')).toBeInTheDocument()
    expect(tile('/media')).toHaveTextContent('low')
    expect(tile('/media')).toHaveTextContent('30 GB free of 1 TB')
    expect(tile('/data')).not.toHaveTextContent('low')
  })

  it('shows an available update as a tile that goes to About', async () => {
    server.use(http.get('/system/status', ({ response }) => response(200).json(status({ update: { version: '0.9.0', url: 'https://example.test/r' } }))))
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })
    const tile = (await within(strip).findByText('Kestrel 0.9.0 available')).closest('li')!
    expect(tile).toHaveTextContent('update')
    expect(within(tile).getByRole('button', { name: 'About' })).toBeInTheDocument()
  })
})

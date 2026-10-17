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
  const state = { rows, calls: [] as string[], bodies: [] as unknown[] }
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({
        count: state.rows.length,
        severity: state.rows.length === 0 ? null : state.rows[0].severity,
        rows: state.rows,
        long_missing: { count: 0, items: [] },
      }),
    ),
    http.post('/attention/{id}/dismiss', ({ params, response }) => {
      state.calls.push(`POST dismiss ${params.id}`)
      state.rows = state.rows.filter((r) => r.id !== params.id)
      return response(204).empty()
    }),
    http.post('/plugin-instances/{id}/test', ({ params, response }) => {
      state.calls.push(`POST test ${params.id}`)
      return response(200).json({ ok: false, code: 'unavailable', message: 'SABnzbd did not answer' })
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

  it('draws whatever actions the server built, as buttons, whatever the kind of row', async () => {
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
    expect(within(row).getByRole('button', { name: 'Take a look' })).toBeInTheDocument()
  })

  it('runs an API action from the row and shows what came back', async () => {
    const state = fakeAttention([sabRow()])
    renderApp()

    const row = await within(await sectionOf(/needs attention/i)).findByRole('listitem')
    await userEvent.click(within(row).getByRole('button', { name: 'Test' }))

    expect(await within(row).findByText('SABnzbd did not answer')).toBeInTheDocument()
    expect(state.calls).toEqual(['POST test 3'])
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
    await userEvent.click(within(row).getByRole('button', { name: 'Open in Settings' }))

    expect(await screen.findByRole('region', { name: 'Download client' })).toBeInTheDocument()
  })

  it('dismisses a one-off warning and the row goes away', async () => {
    const state = fakeAttention([exdevRow()])
    renderApp()

    const section = await sectionOf(/needs attention/i)
    await userEvent.click(await within(section).findByRole('button', { name: 'Dismiss' }))

    expect(await within(section).findByText(/nothing needs attention/i)).toBeInTheDocument()
    expect(state.calls).toEqual(['POST dismiss health-2'])
  })

  it('asks before an action that wants confirmation, and does nothing when declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const state = fakeAttention([
      exdevRow({ actions: [{ key: 'dismiss', label: 'Dismiss', method: 'POST', path: '/attention/health-2/dismiss', body: null, confirm: 'Hide this warning?' }] }),
    ])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(confirm).toHaveBeenCalledWith('Hide this warning?')
    expect(state.calls).toEqual([])
  })

  it('counts the rows on the rail, red while any is Blocking', async () => {
    fakeAttention([sabRow(), exdevRow()])
    renderApp()

    const button = await screen.findByRole('button', { name: /overview.*2 need attention/i })

    expect(within(button).getByText('2')).toHaveClass('bg-red-700')
  })

  it('shows an amber badge when only Warnings are left, and none when there is nothing', async () => {
    const state = fakeAttention([exdevRow()])
    renderApp()

    const button = await screen.findByRole('button', { name: /overview.*1 needs? attention/i })
    expect(within(button).getByText('1')).not.toHaveClass('bg-red-700')

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(state.rows).toHaveLength(0)
  })
})

const status = (over: Partial<Status> = {}): Status => ({
  download_client: { state: 'ok', name: 'SABnzbd', instance_id: 3, message: null },
  indexers: [
    { instance_id: 11, name: 'Alpha', state: 'ok', message: null },
    { instance_id: 12, name: 'Beta', state: 'failing', message: 'API key rejected' },
  ],
  disks: [{ path: '/data', free_bytes: 800 * 2 ** 30, total_bytes: 2 ** 40 }],
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

  it('says when no download client is set up', async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json(status({ download_client: { state: 'none', name: null, instance_id: null, message: null }, indexers: [] })),
      ),
    )
    renderApp()

    const strip = await screen.findByRole('region', { name: /health/i })

    expect(await within(strip).findByText(/no download client/i)).toBeInTheDocument()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Row = components['schemas']['AttentionRow']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
const subject = { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null }

const blocking = (id: string, message: string, actions: Row['actions']): Row => ({
  id,
  severity: 'blocking',
  kind: 'download_client_unreachable',
  subject,
  message,
  since: '2026-10-18T09:00:00Z',
  count: 1,
  actions,
})
const open: Row['actions'][number] = { key: 'open', label: 'Open in Settings', method: 'GET', path: '/settings/download-client', body: null, confirm: null }
const test: Row['actions'][number] = { key: 'test', label: 'Test', method: 'POST', path: '/plugin-instances/3/test', body: null, confirm: null }
const warning = (): Row => ({ ...blocking('w', 'Imports copy instead of moving', []), severity: 'warning', kind: 'exdev' })

function serve(state: { rows: Row[] }) {
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({ count: state.rows.length, severity: state.rows[0]?.severity ?? null, rows: state.rows, long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } }),
    ),
    http.post('/plugin-instances/{id}/test', ({ response }) => response(200).json({ ok: false, code: 'unavailable', message: 'did not answer' })),
  )
}

describe('ProjectBanner for a Blocking row', () => {
  it('shows the first Blocking row and its first action on every screen, and clears with the row', async () => {
    const state = { rows: [blocking('a', 'SABnzbd is unreachable', [open])] }
    serve(state)
    const user = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole('complementary', { name: 'Error' })
    expect(banner).toHaveTextContent('SABnzbd is unreachable')
    expect(screen.getAllByRole('complementary', { name: 'Error' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('complementary', { name: 'Error' })).toHaveTextContent('SABnzbd is unreachable')

    await user.click(screen.getByRole('button', { name: 'Open in Settings' }))
    expect(await screen.findByRole('heading', { name: /download client/i })).toBeInTheDocument()

    state.rows = []
    await user.click(screen.getByRole('button', { name: /^Overview/ }))
    // The stream's hint refetches in the app; here the Overview's remount does.
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Error' })).not.toBeInTheDocument())
  })

  it('counts the other Blocking rows and links to Needs attention', async () => {
    serve({ rows: [blocking('a', 'SABnzbd is unreachable', [open]), blocking('b', 'No indexer can search', [open]), blocking('c', 'Another', [open])] })
    const user = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole('complementary', { name: 'Error' })
    expect(screen.getAllByRole('complementary', { name: 'Error' })).toHaveLength(1)
    expect(banner).not.toHaveTextContent('No indexer can search')
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(screen.getByRole('button', { name: /and 2 more/ }))
    expect(await screen.findByRole('region', { name: /needs attention/i })).toBeInTheDocument()
  })

  it('shows no banner for a Warning row', async () => {
    serve({ rows: [warning()] })
    renderApp()
    await screen.findByRole('region', { name: /needs attention/i })
    expect(screen.queryByRole('complementary', { name: 'Error' })).not.toBeInTheDocument()
  })

  it('runs a non-GET first action and reports a failed answer as a toast', async () => {
    serve({ rows: [blocking('a', 'SABnzbd is unreachable', [test, open])] })
    const user = userEvent.setup()
    renderApp()
    const banner = await screen.findByRole('complementary', { name: 'Error' })
    await user.click(within(banner).getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/Test failed: did not answer/)).toBeInTheDocument()
  })

  it('shows the action pending while its request is open, and ignores a second click', async () => {
    serve({ rows: [blocking('a', 'SABnzbd is unreachable', [test, open])] })
    let calls = 0
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post('/plugin-instances/{id}/test', async ({ response }) => {
        calls++
        await held
        return response(200).json({ ok: true, code: null, message: '' })
      }),
    )
    const user = userEvent.setup()
    renderApp()
    const banner = await screen.findByRole('complementary', { name: 'Error' })
    const action = within(banner).getByRole('button', { name: 'Test' })
    expect(action).not.toHaveAttribute('aria-busy')
    await user.click(action)
    await waitFor(() => expect(within(banner).getByRole('button', { name: 'Test' })).toHaveAttribute('aria-busy', 'true'))
    await user.click(within(banner).getByRole('button', { name: 'Test' }))
    expect(calls).toBe(1)
    release()
    await waitFor(() => expect(within(banner).getByRole('button', { name: 'Test' })).not.toHaveAttribute('aria-busy', 'true'))
  })
})

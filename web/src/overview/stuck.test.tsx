import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Row = components['schemas']['AttentionRow']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const stuckRow: Row = {
  id: 'stuck-7',
  severity: 'warning',
  kind: 'stuck_download',
  subject: { title_id: 5, version_id: 11, grab_id: 7, plugin_instance_id: null },
  message: 'Download of Paddington is stuck · Paused in SABnzbd',
  since: '2026-10-18T09:00:00Z',
  count: 1,
  actions: [
    {
      key: 'search_again',
      label: 'Search Again',
      method: 'POST',
      path: '/grabs/7/cancel',
      body: { blocklist: true },
      confirm: 'Cancel this download and blocklist the Release?',
    },
    { key: 'cancel', label: 'Cancel download', method: 'POST', path: '/grabs/7/cancel', body: null, confirm: 'Cancel this download?' },
  ],
}

function fakeStuck() {
  const state = { rows: [stuckRow], cancels: [] as unknown[] }
  server.use(
    http.get('/attention', ({ response }) =>
      response(200).json({
        count: state.rows.length,
        severity: state.rows.length ? 'warning' : null,
        rows: state.rows,
        long_missing: { count: 0, items: [] },
        originals: { count: 0, items: [] },
      }),
    ),
    http.post('/grabs/{id}/cancel', async ({ request, response }) => {
      const text = await request.clone().text()
      state.cancels.push(text ? JSON.parse(text) : null)
      state.rows = []
      return response(204).empty()
    }),
  )
  return state
}

describe('A Stuck download in Needs attention', () => {
  it('is a Warning about the Title with the reason, and never says stalled', async () => {
    fakeStuck()
    renderApp()

    const row = (await within(await screen.findByRole('region', { name: /needs attention/i })).findAllByRole('listitem'))[0]

    expect(row).toHaveTextContent('Download of Paddington is stuck · Paused in SABnzbd')
    expect(row).toHaveTextContent(/warning/i)
    expect(row).not.toHaveTextContent(/stalled/i)
  })

  it('Cancel only cancels, and the row goes with the Grab', async () => {
    const state = fakeStuck()
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'More Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel download' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel download' }))

    await vi.waitFor(() => expect(state.cancels).toEqual([null]))
    expect(await screen.findByText(/nothing needs attention/i)).toBeInTheDocument()
  })

  it('Search Again cancels with the Release blocklisted', async () => {
    const state = fakeStuck()
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Search Again' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Search Again' }))

    await vi.waitFor(() => expect(state.cancels).toEqual([{ blocklist: true }]))
  })
})

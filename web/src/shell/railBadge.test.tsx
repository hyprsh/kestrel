import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Row = components['schemas']['AttentionRow']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const row = (id: string): Row => ({
  id,
  severity: 'warning',
  kind: 'exdev',
  subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null },
  message: 'Imports copy instead of moving',
  since: '2026-10-18T09:30:00Z',
  count: 1,
  actions: [],
})

const attention = (rows: Row[]) =>
  http.get('/attention', ({ response }) =>
    response(200).json({ count: rows.length, severity: rows.length ? 'warning' : null, rows, long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } }),
  )

describe('Overview button in the rail', () => {
  it('shows the Needs-attention count and puts it in the accessible name', async () => {
    server.use(attention([row('a'), row('b')]))
    renderApp()
    const button = await screen.findByRole('button', { name: /^Overview.*2 need attention/ })
    expect(button).toHaveTextContent('2')
  })

  it('shows no badge when nothing needs attention', async () => {
    renderApp()
    const button = await screen.findByRole('button', { name: /^Overview/ })
    expect(button).toHaveAccessibleName('Overview')
    expect(button).not.toHaveTextContent(/\d/)
  })
})

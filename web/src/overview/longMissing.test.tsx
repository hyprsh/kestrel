import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

type Attention = components['schemas']['Attention']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const warning: Attention['rows'][number] = {
  id: 'health-2',
  severity: 'warning',
  kind: 'exdev',
  subject: { title_id: null, version_id: null, grab_id: null, plugin_instance_id: null },
  message: 'Imports copy instead of moving',
  since: '2026-10-18T09:30:00Z',
  count: 1,
  actions: [],
}

function fakeLongMissing(rows: Attention['rows'] = []) {
  const long_missing: Attention['long_missing'] = {
    count: 7,
    items: [
      { title_id: 3, title: 'Ancient Film', version_id: 31, slot: 'standard', profile: 'hd-primary', wanted_since: '2026-01-01T00:00:00Z', last_failure: 'download_failed' },
      { title_id: 4, title: 'Older Film', version_id: 41, slot: '4k', profile: '4k-primary', wanted_since: '2025-12-01T00:00:00Z', last_failure: null },
    ],
  }
  server.use(
    http.get('/attention', ({ response }) => response(200).json({ count: rows.length, severity: rows.length ? 'warning' : null, rows, long_missing, originals: { count: 0, items: [] } })),
  )
}

describe('the Long Missing row in Needs attention', () => {
  it('is one grouped row after the other rows that expands to the most recent Versions, outside the badge', async () => {
    fakeLongMissing([warning])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    const group = await within(section).findByText('7 Versions long missing')
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(1) // the Warning; the group is not among the rows
    expect(rows[0].compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // and it comes last
    expect(within(section).queryByText(/ancient film/i)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /overview.*1 needs? attention/i })).toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Show' }))

    const items = within(section).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Ancient Film · Standard · hd-primary')
    expect(items[1]).toHaveTextContent('Wanted since 2026-01-01, last failure: download failed')
    expect(items[2]).toHaveTextContent('Older Film · 4K')
    expect(items[2]).not.toHaveTextContent(/last failure/i)
  })

  it('shows alone, with nothing else needing attention and no badge', async () => {
    fakeLongMissing()
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })

    expect(await within(section).findByText('7 Versions long missing')).toBeInTheDocument()
    expect(within(section).getByText(/nothing needs attention/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument() // no "N need attention" in its name
  })

  it('links to the Library on its Wanted filter with the Long Missing chip', async () => {
    fakeLongMissing()
    fakeLibrary([
      row(3, 'Ancient Film', 'Ancient Film', { slots: { standard: { version_id: 31, profile: 'hd-primary', state: 'wanted', long_missing: true }, '4k': null } }),
      row(5, 'Recent Film', 'Recent Film', { slots: { standard: { version_id: 51, profile: 'hd-primary', state: 'wanted', long_missing: false }, '4k': null } }),
    ])
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Open in Library' }))

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(await within(list).findByRole('option', { name: /ancient film/i })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /recent film/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Long Missing' })).toHaveAttribute('aria-pressed', 'true')
  })
})

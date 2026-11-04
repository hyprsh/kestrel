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

/** Seven Versions Long Missing on the server, and two of them in the Library rows the Searching card reads. */
function fakeLongMissing(rows: Attention['rows'] = []) {
  const long_missing: Attention['long_missing'] = {
    count: 7,
    items: [
      { title_id: 3, title: 'Ancient Film', version_id: 31, slot: 'standard', profile: 'hd-primary', wanted_since: '2026-01-01T00:00:00Z', last_failure: 'download_failed' },
      { title_id: 4, title: 'Older Film', version_id: 41, slot: 'standard', profile: 'hd-primary', wanted_since: '2025-12-01T00:00:00Z', last_failure: null },
    ],
  }
  fakeLibrary([
    row(3, 'Ancient Film', 'Ancient Film', { slots: { standard: { version_id: 31, profile: 'hd-primary', state: 'wanted', long_missing: true }, '4k': null } }),
    row(4, 'Older Film', 'Older Film', { slots: { standard: { version_id: 41, profile: 'hd-primary', state: 'wanted', long_missing: true }, '4k': null } }),
    row(5, 'Recent Film', 'Recent Film', { slots: { standard: { version_id: 51, profile: 'hd-primary', state: 'wanted', long_missing: false }, '4k': null } }),
  ])
  server.use(http.get('/attention', ({ response }) => response(200).json({ count: rows.length, severity: rows.length ? 'warning' : null, rows, long_missing, originals: { count: 0, items: [] } })))
}

describe('Long Missing on the Overview', () => {
  it('is not in Needs attention, which keeps only the rows the server raised', async () => {
    fakeLongMissing([warning])
    renderApp()

    const section = await screen.findByRole('region', { name: /needs attention/i })
    expect(await within(section).findByText('Imports copy instead of moving')).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem')).toHaveLength(1)
    expect(section).not.toHaveTextContent(/long missing/i)
    expect(within(section).queryByRole('button', { name: /show|hide|open in library/i })).not.toBeInTheDocument()
  })

  it('leaves Needs attention out when Long Missing is all there is', async () => {
    fakeLongMissing()
    renderApp()

    await within(await screen.findByRole('region', { name: 'Searching' })).findByRole('button', { name: /long missing/ })
    expect(screen.queryByRole('region', { name: /needs attention/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument() // no "N need attention" in its name
  })

  it('is one quiet line in the Searching card that links to the Library filtered to is:long_missing, the longest Wanted first', async () => {
    fakeLongMissing()
    renderApp()

    const card = await screen.findByRole('region', { name: 'Searching' })
    await userEvent.click(await within(card).findByRole('button', { name: 'Wanted 3 · 2 long missing' }))

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(await within(list).findByRole('option', { name: /ancient film/i })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /recent film/i })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter the Library' })).toHaveValue('is:long_missing sort:wanted_since')
    expect(location.pathname).toBe('/library')
    expect(new URLSearchParams(location.search).get('q')).toBe('is:long_missing sort:wanted_since')
  })
})

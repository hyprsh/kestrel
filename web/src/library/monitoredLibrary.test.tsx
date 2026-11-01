import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row, type FixtureRow } from '../test/library'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Slots = FixtureRow['slots']
const hd = (state: 'wanted' | 'filled' | 'unmonitored'): Slots => ({ standard: { version_id: 1, profile: 'hd-primary', state, long_missing: false }, '4k': null })

async function openLibrary() {
  fakeLibrary([
    row(1, 'Paddington in Peru', 'Paddington in Peru', { slots: hd('filled'), wanted_since: null }),
    row(2, 'Paddington 2', 'Paddington 2', { slots: hd('filled'), monitored: false, wanted_since: null }),
    row(3, 'Better Call Saul', 'Better Call Saul', { slots: hd('unmonitored'), monitored: false, wanted_since: null, kind: 'series' }),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

describe('monitoring in the Library list', () => {
  it('shows the bookmark at the right of every row, and dims an unmonitored row on a background-200 row', async () => {
    const list = await openLibrary()
    const rows = await within(list).findAllByRole('option')
    const byTitle = (t: string) => rows.find((r) => r.querySelector('[data-title]')?.textContent === t)!

    const on = byTitle('Paddington in Peru')
    expect(on).toHaveAttribute('data-monitored', 'on')
    expect(on.querySelector('[data-monitor-mark="on"]')).toHaveAttribute('title', 'Monitored')

    for (const t of ['Paddington 2', 'Better Call Saul']) {
      const off = byTitle(t)
      expect(off).toHaveAttribute('data-monitored', 'off')
      expect(off.querySelector('[data-monitor-mark="off"]')).toHaveAttribute('title', 'Not monitored')
      expect(off.querySelector('[data-state-line]')).toHaveTextContent('Not monitored')
    }
  })

  it('has a Not monitored view with a count, which keeps only the unmonitored Titles', async () => {
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    const view = screen.getByRole('menuitemradio', { name: 'Not monitored' })
    expect(view).toHaveTextContent(/^Not monitored2$/)
    expect(view.querySelector('svg')).not.toBeNull() // the bookmark
    await userEvent.click(view)

    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.querySelector('[data-title]')?.textContent),
    ).toEqual(['Paddington 2', 'Better Call Saul'])
    expect(location.search).toContain('is%3Aunmonitored') // the view is the is:unmonitored token
  })
})

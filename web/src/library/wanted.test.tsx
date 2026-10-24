import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Slots = components['schemas']['TitleRow']['slots']
const hd = (state: 'wanted' | 'filled', long = false): Slots => ({
  standard: { version_id: 1, profile: 'hd-primary', state, long_missing: long },
  '4k': null,
})

const rows = () => [
  row(1, 'Filled Film', 'Filled Film', { slots: hd('filled'), wanted_since: null }),
  row(2, 'Recent Film', 'Recent Film', { slots: hd('wanted'), wanted_since: '2026-10-10T00:00:00Z' }),
  row(3, 'Ancient Film', 'Ancient Film', { slots: hd('wanted', true), wanted_since: '2026-01-01T00:00:00Z' }),
]

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

const names = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.textContent?.replace(/\d{4}$/, '').trim())

const filter = () => screen.getByRole('combobox', { name: 'Filter the Library' })

describe('the Library filter, typed', () => {
  it('narrows to Wanted, then Long Missing, with the State menu ticking along and taking it off again', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(screen.queryByRole('button', { name: 'Wanted' })).not.toBeInTheDocument() // typed now, not toggled

    await userEvent.type(filter(), 'is:wanted ')
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(within(list).queryByRole('option', { name: /filled film/i })).not.toBeInTheDocument()

    await userEvent.type(filter(), 'is:long_missing ')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByRole('option', { name: /ancient film/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^State/ }))
    expect(screen.getByRole('option', { name: 'Wanted' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Long Missing' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Filled' })).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(screen.getByRole('option', { name: 'Wanted' }))
    await userEvent.click(screen.getByRole('option', { name: 'Long Missing' }))
    expect(filter()).toHaveValue('')
    expect(within(list).getAllByRole('option')).toHaveLength(3)
  })

  it('sorts by Wanted since, the longest Wanted first and Titles that are not Wanted last', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(names(list)[0]).toMatch(/filled film/i) // the server's order

    await userEvent.type(filter(), 'sort:wanted_since')

    expect(names(list).map((n) => n?.replace(/\s*\d*$/, ''))).toEqual(['Ancient Film', 'Recent Film', 'Filled Film'])
  })

  it('completes Profile names', async () => {
    fakeLibrary([...rows(), row(4, 'Big Film', 'Big Film', { slots: { standard: null, '4k': { version_id: 4, profile: '4k-primary', state: 'wanted', long_missing: false } } })])
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    const user = userEvent.setup()

    await user.type(filter(), 'profile:4')
    const suggestions = await screen.findByRole('listbox', { name: 'Suggestions' })
    expect(within(suggestions).getAllByRole('option').map((o) => o.textContent)).toEqual(['4K'])
    await user.keyboard('{Enter}')

    expect(filter()).toHaveValue('profile:4K')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByRole('option', { name: /big film/i })).toBeInTheDocument()
  })
})

describe('Search all Wanted in the command menu', () => {
  it('posts to /wanted/search', async () => {
    fakeLibrary([])
    let posted = 0
    server.use(
      http.post('/wanted/search', ({ response }) => {
        posted++
        return response(202).json({ versions: 3 })
      }),
    )
    renderApp()
    await screen.findByRole('navigation')
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: /command menu/i })

    await userEvent.type(within(menu).getByRole('combobox'), 'search all')
    await userEvent.click(await within(menu).findByRole('option', { name: /search all wanted/i }))

    await waitFor(() => expect(posted).toBe(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirms how many Versions it queued in a Toast, with no link and no strip', async () => {
    fakeLibrary([])
    server.use(http.post('/wanted/search', ({ response }) => response(202).json({ versions: 2 })))
    await openLibrary()
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: /command menu/i })
    await userEvent.type(within(menu).getByRole('combobox'), 'search all')
    await userEvent.click(await within(menu).findByRole('option', { name: /search all wanted/i }))

    const toasts = await screen.findByRole('region', { name: 'Notifications' })
    expect(await within(toasts).findByText('2 Wanted Versions queued for a search')).toBeInTheDocument()
    expect(within(toasts).queryByRole('button', { name: /see the search/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /search all wanted/i })).not.toBeInTheDocument()
    expect(location.pathname).toBe('/library')
  })

  it('says in a Toast when the search could not be queued', async () => {
    fakeLibrary([])
    server.use(http.post('/wanted/search', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'boom', detail: 'the indexer is down' }, { status: 500 })))
    await openLibrary()
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: /command menu/i })
    await userEvent.type(within(menu).getByRole('combobox'), 'search all')
    await userEvent.click(await within(menu).findByRole('option', { name: /search all wanted/i }))

    const toasts = await screen.findByRole('region', { name: 'Notifications' })
    expect(await within(toasts).findByText(/search all wanted failed: the indexer is down/i)).toBeInTheDocument()
  })
})

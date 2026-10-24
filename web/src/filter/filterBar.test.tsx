// The filter menus beside the filter field: the query text is the only state, so a menu and the
// field agree both ways, an exclusion shows in both, and text no menu owns stays as typed.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
afterEach(() => vi.unstubAllGlobals())

const slots = (standard: 'wanted' | 'filled', fourK: 'wanted' | 'filled' | null = null) => ({
  standard: { version_id: 1, profile: 'hd-primary', state: standard, long_missing: false },
  '4k': fourK && { version_id: 2, profile: '4k-primary', state: fourK, long_missing: false },
})
const library = () => [row(1, 'Heat', 'Heat', { slots: slots('wanted') }), row(2, 'Zodiac', 'Zodiac', { slots: slots('filled', 'wanted') }), row(3, 'Alien', 'Alien', { slots: slots('filled') })]

const menu = (name: RegExp) => screen.getByRole('button', { name })
const option = (name: string) => screen.getByRole('option', { name: new RegExp(`^${name}(, excluded)?$`) })
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('option')
    .map((o) => o.textContent?.replace(/\d{4}$/, '').trim())

describe('the Library filter menus', () => {
  async function open() {
    fakeLibrary(library())
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const list = await screen.findByRole('listbox', { name: /library/i })
    await within(list).findAllByRole('option')
    return { list, field: screen.getByRole('combobox', { name: 'Filter the Library' }) }
  }

  it('writes a ticked row into the field and ticks the row of a term typed there', async () => {
    const { list, field } = await open()
    await userEvent.type(field, 'zod is:wanted')
    expect(titles(list)).toEqual(['Zodiac'])

    await userEvent.click(menu(/^Slot/))
    await userEvent.click(option('4K'))
    expect(field).toHaveValue('zod is:wanted slot:4k') // free text and the other terms stay
    expect(option('4K')).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')

    await userEvent.clear(field)
    await userEvent.type(field, 'is:filled,wanted')
    await userEvent.click(menu(/^State/))
    expect(option('Wanted')).toHaveAttribute('aria-selected', 'true')
    expect(option('Filled')).toHaveAttribute('aria-selected', 'true')
    expect(option('Unreleased')).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(option('Filled'))
    expect(field).toHaveValue('is:wanted')
  })

  it('shows a typed exclusion in the menu, and excludes a row with Shift+Enter', async () => {
    const { list, field } = await open()
    await userEvent.type(field, '-slot:4k')
    expect(titles(list)).toEqual(['Heat', 'Alien'])
    await userEvent.click(menu(/^Slot/))
    expect(screen.getByRole('option', { name: '4K, excluded' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Slot' })).not.toBeInTheDocument())

    await userEvent.clear(field)
    await userEvent.click(menu(/^Slot/))
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Slot' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}{Shift>}{Enter}{/Shift}')
    expect(field).toHaveValue('-slot:4k')
    expect(screen.getByRole('option', { name: '4K, excluded' })).toBeInTheDocument()
    expect(titles(list)).toEqual(['Heat', 'Alien'])
  })

  it('sorts from the Sort menu and clears it with the default row', async () => {
    const { field } = await open()
    await userEvent.click(menu(/^Sort/))
    await userEvent.click(screen.getByRole('option', { name: 'Wanted longest' }))
    expect(field).toHaveValue('sort:wanted_since')
    await userEvent.click(menu(/^Sort/))
    await userEvent.click(screen.getByRole('option', { name: 'Default' }))
    expect(field).toHaveValue('')
  })
})

describe('the Log filter menus', () => {
  const event = (id: number, kind: string): components['schemas']['Event'] => ({
    id,
    at: '2026-10-17T12:00:00Z',
    kind,
    routine: false,
    title_id: null,
    version_id: null,
    episode_id: null,
    grab_id: null,
    request_id: null,
    message: `Event ${id}`,
    data: null,
  })
  async function open() {
    const sent: URLSearchParams[] = []
    server.use(
      http.get('/events', ({ request, response }) => {
        sent.push(new URL(request.url).searchParams)
        return response(200).json({ items: [event(1, 'grab'), event(2, 'import')] })
      }),
    )
    fakeLibrary(library())
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Log' }))
    await screen.findByRole('table', { name: 'Events' })
    return { sent, field: screen.getByRole('combobox', { name: 'Filter the Log' }) }
  }

  it('keeps Kind and the field in step, with kinds and groups as rows', async () => {
    const { sent, field } = await open()
    await userEvent.type(field, 'slot:4k kind:grab_failed')
    await userEvent.click(menu(/^Kind/))
    expect(option('Failed')).toHaveAttribute('aria-selected', 'true')
    expect(option('Failures')).toHaveAttribute('aria-selected', 'false') // a group is a row of its own
    await userEvent.click(option('Imported'))
    expect(field).toHaveValue('slot:4k kind:grab_failed,import')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import'])
  })

  it('shows an excluded kind as excluded, and the Title menu offers the Titles of the Library', async () => {
    const { sent, field } = await open()
    await userEvent.type(field, '-kind:grab_failed')
    await userEvent.click(menu(/^Kind/))
    expect(screen.getByRole('option', { name: 'Failed, excluded' })).toBeInTheDocument()
    await expect.poll(() => sent.at(-1)?.getAll('exclude_kind')).toEqual(['grab_failed'])
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Kind' })).not.toBeInTheDocument())

    await userEvent.click(menu(/^Title/))
    await userEvent.click(screen.getByRole('option', { name: 'Zodiac' }))
    expect(field).toHaveValue('-kind:grab_failed title:Zodiac')
  })
})

describe('on a phone', () => {
  it('shows the menus inline under the field, with no extra Filters level', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    fakeLibrary(library())
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }))
    const field = screen.getByRole('combobox', { name: 'Filter the Library' })
    expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument()
    for (const name of [/^State/, /^Slot/, /^Profile/, /^Sort/]) expect(menu(name)).toBeInTheDocument()

    await userEvent.click(menu(/^Slot/))
    await userEvent.click(option('4K'))
    expect(field).toHaveValue('slot:4k')
  })
})

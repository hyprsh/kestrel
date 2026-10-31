// The Filter button beside the filter field: the query text is the only state, so its menu and the
// field agree both ways, an exclusion shows in both, and text no facet owns stays as typed.
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

const filterButton = () => screen.getByRole('button', { name: /^Filter( ·|,|$)/ })
/** A row of the Filter menu, by its name; a hint such as Excluded may follow it. A Profile named like a Slot comes after the Slot's row, so the first is the Slot's. */
const item = (name: string) => screen.getAllByRole('menuitemcheckbox', { name: new RegExp(`^${name}(\\s?Excluded)?$`) })[0]
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('option')
    .map((o) => o.querySelector('[data-title]')?.textContent)

describe('the Library Filter button', () => {
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

    await userEvent.click(filterButton())
    await userEvent.click(item('4K'))
    expect(field).toHaveValue('zod is:wanted slot:4k') // free text and the other terms stay
    expect(item('4K')).toHaveAttribute('aria-checked', 'true')
    expect(filterButton()).toHaveTextContent('Filter · 2') // the Slot and the is:wanted Status
    await userEvent.keyboard('{Escape}')

    await userEvent.clear(field)
    await userEvent.type(field, 'kind:movie,series')
    await userEvent.click(filterButton())
    expect(item('Movies')).toHaveAttribute('aria-checked', 'true')
    expect(item('Series')).toHaveAttribute('aria-checked', 'true')
    expect(filterButton()).toHaveTextContent('Filter · 1') // two values of one facet are one active facet
    await userEvent.click(item('Movies'))
    expect(field).toHaveValue('kind:series')
  })

  it('shows a typed exclusion in the menu as Excluded, and choosing it takes the term out', async () => {
    const { list, field } = await open()
    await userEvent.type(field, '-slot:4k')
    expect(titles(list)).toEqual(['Heat', 'Alien'])
    await userEvent.click(filterButton())
    expect(item('4K')).toHaveTextContent('Excluded')
    expect(item('4K')).toHaveAttribute('aria-checked', 'false')
    expect(filterButton()).toHaveTextContent('Filter · 1')

    await userEvent.click(item('4K'))
    expect(field).toHaveValue('')
    expect(titles(list)).toEqual(['Heat', 'Zodiac', 'Alien'])
  })

  it('excludes a row with Shift+Enter, and a plain Enter on it clears the exclusion', async () => {
    const { list, field } = await open()
    await userEvent.click(filterButton())
    item('4K').focus()
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(field).toHaveValue('-slot:4k')
    expect(item('4K')).toHaveTextContent('Excluded')
    expect(filterButton()).toHaveTextContent('Filter · 1') // an excluded value counts toward the badge
    expect(titles(list)).toEqual(['Heat', 'Alien'])

    item('4K').focus()
    await userEvent.keyboard('{Enter}')
    expect(field).toHaveValue('')
  })

  it('excludes a row with Shift+click, moving a value that was included over to the exclusion', async () => {
    const { field } = await open()
    await userEvent.type(field, 'slot:4k')
    await userEvent.click(filterButton())
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(item('4K'))
    await user.keyboard('{/Shift}')
    expect(field).toHaveValue('-slot:4k')
    expect(item('4K')).toHaveAttribute('aria-checked', 'false')
    expect(item('4K')).toHaveTextContent('Excluded')
  })

  it("excludes from the row's own action, and says how to exclude at the foot of the menu", async () => {
    const { list, field } = await open()
    await userEvent.type(field, 'zod')
    await userEvent.click(filterButton())
    expect(screen.getByText('Shift-click to exclude')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Exclude 4K', hidden: true })[0]) // the Slot's row comes before a Profile named alike
    expect(field).toHaveValue('zod -slot:4k')
    expect(item('4K')).toHaveTextContent('Excluded')
    expect(screen.getAllByRole('button', { name: 'Exclude 4K', hidden: true })).toHaveLength(1) // an excluded row has no action: only the Profile's is left
    expect(within(list).queryAllByRole('option')).toHaveLength(0) // zod is the one Title with a 4K Version
  })

  it('sorts from the Display menu and clears it with the default row', async () => {
    const { field } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Display' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Wanted longest' }))
    expect(field).toHaveValue('sort:wanted_since')
    await userEvent.click(screen.getByRole('button', { name: 'Display' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Name A–Z' }))
    expect(field).toHaveValue('sort:name-asc') // one sort term, not two
    await userEvent.click(screen.getByRole('button', { name: 'Display' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Newest added' }))
    expect(field).toHaveValue('')
  })
})

describe('the Log Filter button', () => {
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
    await userEvent.click(filterButton())
    expect(item('Failed')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: /^Failures/ })).toHaveAttribute('aria-checked', 'false') // a group is a row of its own
    await userEvent.click(item('Imported'))
    expect(field).toHaveValue('slot:4k kind:grab_failed,import')
    await expect.poll(() => sent.at(-1)?.getAll('kind')).toEqual(['grab_failed', 'import'])
  })

  it('shows an excluded kind as excluded, and the Title menu offers the Titles of the Library', async () => {
    const { sent, field } = await open()
    await userEvent.type(field, '-kind:grab_failed')
    await userEvent.click(filterButton())
    expect(item('Failed')).toHaveTextContent('Excluded')
    await expect.poll(() => sent.at(-1)?.getAll('exclude_kind')).toEqual(['grab_failed'])

    await userEvent.click(item('Zodiac')) // the Title facet sits in the same menu
    await waitFor(() => expect(filterButton()).toHaveTextContent('Filter · 2'))
    expect(field).toHaveValue('-kind:grab_failed title:Zodiac')
  })
})

describe('on a phone', () => {
  it('keeps Filter and Display as icon buttons beside the field, with the same Filter menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    fakeLibrary(library())
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const field = await screen.findByRole('combobox', { name: 'Filter the Library' })
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument()
    await userEvent.click(filterButton())
    for (const name of ['Movies', 'Standard', '4K']) expect(item(name)).toBeInTheDocument()

    await userEvent.click(item('4K'))
    expect(field).toHaveValue('slot:4k')
    expect(filterButton()).toHaveAccessibleName(/^Filter.*1 active/)
    expect(filterButton()).toHaveTextContent(/^1$/) // the funnel carries the count as its badge
  })
})

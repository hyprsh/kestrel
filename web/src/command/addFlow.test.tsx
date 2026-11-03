import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findToast } from '../test/toasts'
import { fakeTmdb, openMenu, renderApp, settingsWithRoots } from './testkit'

/** The menu on Paddington's page: typed, then Enter on the result. */
async function openPaddington(f = fakeTmdb()) {
  renderApp()
  const menu = await openMenu()
  await userEvent.keyboard('padd')
  await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
  await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
  await within(menu).findByRole('option', { name: /^Standard/ })
  return { ...f, menu }
}

/** Breaking Bad's page, once TheTVDB's overview is in. */
async function openBreakingBad(overview?: Promise<'ok' | 'down'>) {
  const f = fakeTmdb({ overview })
  renderApp()
  const menu = await openMenu()
  await userEvent.keyboard('break')
  await userEvent.click(await within(menu).findByRole('option', { name: /^Breaking Bad/ }))
  await within(menu).findByRole('option', { name: /^Monitor/ })
  if (!overview) await within(menu).findByText(/7 episodes/)
  return { ...f, menu }
}

const option = (menu: HTMLElement, name: string | RegExp) => within(menu).getByRole('option', { name })
const sub = (o: HTMLElement) => o.querySelector('[data-row] > span:nth-child(2)')?.textContent
/** The check that marks a list's current value. */
const current = (o: HTMLElement) => within(o).queryByRole('img', { name: 'Current' })

describe('a Title page in the command menu', () => {
  it('opens on Enter, with the Title, its facts, its overview and one row per choice', async () => {
    const { menu } = await openPaddington()
    expect(within(menu).getByRole('img', { name: 'Paddington poster' })).toBeInTheDocument()
    expect(await within(menu).findByText('A bear travels to London.')).toBeInTheDocument()
    expect(within(menu).getByText(/Movie · Heyday Films · United Kingdom · 1 h 35 min/)).toBeInTheDocument()
    expect(sub(option(menu, /^Standard/))).toBe('Profile HD · the default')
    expect(option(menu, /^Standard/)).toHaveTextContent('On')
    expect(sub(option(menu, /^4K/))).toBe('Not added')
    expect(option(menu, /^4K/)).toHaveTextContent('Off')
    expect(sub(option(menu, /^Root Folder/))).toMatch(/^\//)
    expect(within(menu).queryByRole('option', { name: /^Monitor/ })).not.toBeInTheDocument() // a Movie has nothing to monitor at add
    expect(option(menu, /^Add Movie/)).toBeInTheDocument()
  })

  it('opens from the keyboard alone with Enter on the highlighted result, and Esc goes back one level at a time', async () => {
    fakeTmdb()
    renderApp()
    const menu = await openMenu()
    await userEvent.keyboard('padd')
    await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    // Library rows come first: move to the first TMDB result.
    const results = within(within(menu).getAllByRole('group').at(-1)!).getAllByRole('option')
    while (!results.includes(within(menu).getByRole('option', { selected: true }))) await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    const input = await within(menu).findByRole('combobox', { name: 'Filter the choices for Paddington' })
    expect(input).toHaveFocus()
    await userEvent.keyboard('{Enter}') // the first choice, Standard: its list of Profiles
    const profile = await within(menu).findByRole('combobox', { name: 'Paddington › Standard' })
    expect(profile).toHaveFocus()
    expect(within(menu).getByText('Paddington › Standard', { selector: '[role="status"]' })).toBeInTheDocument() // announced

    await userEvent.keyboard('{Escape}') // back to the page
    expect(await within(menu).findByRole('combobox', { name: 'Filter the choices for Paddington' })).toHaveFocus()
    await userEvent.keyboard('{Escape}') // back to the results, the query as typed
    expect(await within(menu).findByRole('combobox', { name: /search/i })).toHaveValue('padd')
    expect(within(menu).getByRole('option', { name: /^Paddington\b(?!.*Returns)/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}') // at the root Esc closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes back with Backspace in an empty filter', async () => {
    const { menu } = await openPaddington()
    await userEvent.keyboard('{Enter}')
    await within(menu).findByRole('combobox', { name: 'Paddington › Standard' })
    await userEvent.keyboard('{Backspace}')
    expect(await within(menu).findByRole('combobox', { name: 'Filter the choices for Paddington' })).toBeInTheDocument()
  })

  it('filters the choices by what is typed', async () => {
    const { menu } = await openPaddington()
    await userEvent.keyboard('root')
    expect(within(menu).queryByRole('option', { name: /^Standard/ })).not.toBeInTheDocument()
    expect(option(menu, /^Root Folder/)).toBeInTheDocument()
    expect(option(menu, /^Add Movie/)).toBeInTheDocument() // the Add row stays
  })

  it('adds with the Slots preselected, closes the menu and confirms in a Toast that opens the Title', async () => {
    const { menu, sent } = await openPaddington()
    await userEvent.click(option(menu, /^Add Movie/))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ kind: 'movie', tmdb_id: 116149, versions: [{ slot: 'standard', profile: 'hd-primary' }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await findToast(/Added Paddington/)
    expect(await screen.findByText('Standard')).toBeInTheDocument() // what was added, under it
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /paddington/i, selected: true })).toBeInTheDocument()
  })

  it('adds with ⌘↵ from the page', async () => {
    const { sent } = await openPaddington()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(sent).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adds the highlighted result with the defaults on ⌘↵, without opening its page', async () => {
    fakeTmdb()
    const f = fakeTmdb()
    renderApp()
    const menu = await openMenu()
    await userEvent.keyboard('padd')
    const first = await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    await userEvent.hover(first)
    await userEvent.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({ kind: 'movie', tmdb_id: 116149, versions: [{ slot: 'standard', profile: 'hd-primary' }] })
    expect(await findToast(/Added Paddington/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('changes a Slot in its own list, marks it Changed and sends it', async () => {
    const { menu, sent } = await openPaddington()
    await userEvent.click(option(menu, /^4K/))
    // Off is the current choice, and a Profile another Slot uses says so.
    expect(current(option(menu, /^Off/))).toBeInTheDocument()
    expect(sub(option(menu, 'HD Used by Standard'))).toBe('Used by Standard')
    await userEvent.click(option(menu, /^4K/)) // the Profile named 4K
    // Picking pops back to the page.
    const row = await within(menu).findByRole('option', { name: /^4K\b.*Profile 4K/ })
    expect(row).toHaveTextContent('Changed')
    expect(sub(option(menu, /^Add Movie/))).toBe('Standard and 4K · HD and 4K · ' + sub(option(menu, /^Root Folder/)))

    await userEvent.click(option(menu, /^Add Movie/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({
      kind: 'movie',
      tmdb_id: 116149,
      versions: [
        { slot: 'standard', profile: 'hd-primary' },
        { slot: '4k', profile: '4k-primary' },
      ],
    })
  })

  it('switches a Slot off in its list', async () => {
    const { menu, sent } = await openPaddington()
    await userEvent.click(option(menu, /^Standard/))
    expect(current(option(menu, /^HD/))).toBeInTheDocument()
    await userEvent.click(option(menu, /^Any$/))
    expect(await within(menu).findByRole('option', { name: /^Standard.*Profile Any/ })).toHaveTextContent('Changed')
    await userEvent.click(option(menu, /^Add Movie/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ versions: [{ slot: 'standard', profile: 'any-primary' }] })
  })

  it('lists the root folders, marks the current one and sends the one picked', async () => {
    settingsWithRoots(['/data/movies', '/data/more-movies'])
    const { menu, sent } = await openPaddington()
    await userEvent.click(option(menu, /^Root Folder/))
    expect(current(option(menu, /^\/data\/movies/))).toBeInTheDocument()
    await userEvent.click(option(menu, /^\/data\/more-movies/))
    expect(await within(menu).findByRole('option', { name: /^Root Folder.*\/data\/more-movies/ })).toHaveTextContent('Changed')
    await userEvent.click(option(menu, /^Add Movie/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ kind: 'movie', tmdb_id: 116149, versions: [{ slot: 'standard', profile: 'hd-primary' }], root_folder: '/data/more-movies' })
  })

  it('keeps the page open and shows the error when adding fails, the Profile on its Slot', async () => {
    const problem = {
      type: 'about:blank',
      title: 'unprocessable',
      status: 422,
      code: 'invalid',
      detail: 'Some choices are invalid',
      errors: [{ field: 'versions[0].profile', code: 'profile_taken', message: 'HD is used by another Version of this Title' }],
    }
    const { menu, sent } = await openPaddington(fakeTmdb({ create: () => ({ status: 422, body: problem }) }))
    await userEvent.click(option(menu, /^Add Movie/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(await within(menu).findByText('Some choices are invalid')).toBeInTheDocument()
    expect(sub(option(menu, /^Standard/))).toBe('HD is used by another Version of this Title')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('a Series page', () => {
  it('gives the facts TheTVDB adds once its overview is in: seasons, episodes and status', async () => {
    const { menu } = await openBreakingBad()
    expect(within(menu).getByText(/Series · AMC · United States · 3 seasons · 7 episodes · Ended/)).toBeInTheDocument()
  })

  it('opens the Monitor list, with All Episodes current, and marks a change', async () => {
    const { menu, sent } = await openBreakingBad()
    expect(sub(option(menu, /^Monitor/))).toBe('All Episodes')
    await userEvent.click(option(menu, /^Monitor/))
    expect(await within(menu).findByRole('combobox', { name: 'Breaking Bad › Monitor' })).toBeInTheDocument()
    expect(current(option(menu, /^All Episodes/))).toBeInTheDocument()
    await userEvent.click(option(menu, /^Future Episodes Only/))

    const row = await within(menu).findByRole('option', { name: /^Monitor/ })
    expect(row).toHaveTextContent('Future Episodes Only')
    expect(row).toHaveTextContent('Changed')
    expect(sub(option(menu, /^Add Series/))).toMatch(/future episodes/)
    await userEvent.click(option(menu, /^Add Series/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ kind: 'series', series_monitor: 'future' })
    await findToast(/Added Breaking Bad/)
    expect(await screen.findByText('Standard · future episodes')).toBeInTheDocument()
  })

  it('adds only the first season, and nothing that comes later', async () => {
    const { menu, sent } = await openBreakingBad()
    await userEvent.click(option(menu, /^Monitor/))
    await userEvent.click(option(menu, /^First Season/))
    await userEvent.click(option(menu, /^Add Series/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ kind: 'series', tmdb_id: 1396, versions: [{ slot: 'standard', profile: 'hd-primary' }], series_monitor: 'none', seasons: [1] })
  })

  it('adds the latest season that aired, and follows new seasons', async () => {
    const { menu, sent } = await openBreakingBad()
    await userEvent.click(option(menu, /^Monitor/))
    expect(option(menu, /^Latest Season \(2\)/)).toBeInTheDocument()
    await userEvent.click(option(menu, /^Latest Season/))
    expect(sub(option(menu, /^Monitor/))).toBe('Latest Season (2)')
    await userEvent.click(option(menu, /^Add Series/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'future', seasons: [2] })
  })

  it('adds the seasons picked, Specials included, with a toggle for new seasons', async () => {
    const { menu, sent } = await openBreakingBad()
    await userEvent.click(option(menu, /^Monitor/))
    await userEvent.click(option(menu, /^Pick Seasons…/)) // a list of seasons inside the list
    expect(await within(menu).findByRole('combobox', { name: 'Breaking Bad › Monitor › Pick Seasons' })).toBeInTheDocument()
    const specials = option(menu, /^Specials/)
    expect(current(specials)).not.toBeInTheDocument()
    await userEvent.click(specials)
    await userEvent.click(option(menu, /^Season 2/))
    expect(current(option(menu, /^Season 2/))).toBeInTheDocument()
    expect(current(option(menu, /^Follow New Seasons/))).toBeInTheDocument()
    await userEvent.click(option(menu, /^Follow New Seasons/))
    expect(current(option(menu, /^Follow New Seasons/))).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}{Escape}') // back to the page
    expect(sub(await within(menu).findByRole('option', { name: /^Monitor/ }))).toBe('Seasons Specials and 2')
    await userEvent.click(option(menu, /^Add Series/))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'none', seasons: [0, 2] })
  })

  it('opens before TheTVDB answers, with the season choices off and saying why', async () => {
    let answer: (v: 'down') => void = () => {}
    const { menu, sent } = await openBreakingBad(new Promise((resolve) => (answer = resolve)))
    await userEvent.click(option(menu, /^Monitor/))
    for (const name of [/^First Season/, /^Latest Season/, /^Pick Seasons…/]) {
      expect(option(menu, name)).toHaveAttribute('aria-disabled', 'true')
      expect(sub(option(menu, name))).toBe('Waits for the series overview')
    }
    answer('down')
    await waitFor(() => expect(sub(option(menu, /^First Season/))).toBe('Needs the series overview, which could not be loaded'))
    expect(option(menu, /^All Episodes/)).not.toHaveAttribute('aria-disabled')
    await userEvent.keyboard('{Escape}')
    expect(await within(menu).findByText(/Could not load the series overview/)).toBeInTheDocument()
    await userEvent.click(option(menu, /^Add Series/)) // adding still works
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ series_monitor: 'all' })
  })
})

describe('the command menu on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubPhone = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 639'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

  async function openOnPhone() {
    stubPhone()
    const f = fakeTmdb()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Search or Add' }))
    const menu = await screen.findByRole('dialog', { name: /command menu/i })
    return { ...f, menu }
  }

  it('opens a sheet from the Search tab, with the search field and Cancel', async () => {
    const { menu } = await openOnPhone()
    expect(within(menu).getByRole('combobox', { name: /search/i })).toHaveFocus()
    expect(within(menu).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a tapped result as a page with a Back button in place of the field, and a full-width Add that stays', async () => {
    const { menu, sent } = await openOnPhone()
    await userEvent.keyboard('padd')
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))

    const bar = await within(menu).findByRole('heading', { level: 1, name: 'Paddington' })
    expect(bar).toBeInTheDocument()
    expect(within(menu).queryByRole('combobox')).not.toBeInTheDocument() // no field, so no keyboard
    expect(within(menu).getByRole('button', { name: 'Add Movie' })).toBeInTheDocument()
    expect(within(menu).queryByRole('option', { name: /^Add Movie/ })).not.toBeInTheDocument() // the button is the Add

    await userEvent.click(within(menu).getByRole('option', { name: /^Root Folder/ }))
    expect(await within(menu).findByRole('heading', { level: 1, name: 'Root Folder' })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('button', { name: 'Back to Paddington' }))
    expect(await within(menu).findByRole('heading', { level: 1, name: 'Paddington' })).toBeInTheDocument()

    await userEvent.click(within(menu).getByRole('button', { name: 'Add Movie' })) // still there after the list
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(await findToast(/Added Paddington/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes back to the results with Back, and with an edge swipe', async () => {
    const { menu } = await openOnPhone()
    await userEvent.keyboard('padd')
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
    await userEvent.click(await within(menu).findByRole('button', { name: 'Back to Results' }))
    expect(await within(menu).findByRole('combobox', { name: /search/i })).toHaveValue('padd')

    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
    const page = (await within(menu).findByRole('heading', { level: 1, name: 'Paddington' })).closest('.cmd-level')!
    const touch = (clientX: number) => ({ touches: [{ clientX, clientY: 300 }], changedTouches: [{ clientX, clientY: 300 }] })
    fireEvent.touchStart(page, touch(4))
    fireEvent.touchEnd(page, touch(140))
    expect(await within(menu).findByRole('combobox', { name: /search/i })).toBeInTheDocument()
  })
})

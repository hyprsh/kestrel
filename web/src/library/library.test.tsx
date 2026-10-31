import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const rows = () => [
  row(1, 'Paddington', 'Ein Bär namens Paddington', {
    slots: {
      standard: { version_id: 11, profile: 'any-primary', state: 'wanted', long_missing: false },
      '4k': { version_id: 12, profile: '4k-primary', state: 'filled', long_missing: false },
    },
  }),
  row(2, 'Heat', 'Heat', { year: 1995 }),
  row(3, 'Zodiac', 'Zodiac', { year: 2007 }),
]

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

const selected = () => within(screen.getByRole('listbox', { name: /library/i })).getByRole('option', { selected: true })
const filter = () => screen.getByRole('combobox', { name: 'Filter the Library' })
const shown = (list: HTMLElement) =>
  within(list)
    .queryAllByRole('option')
    .map((o) => o.textContent)

describe('the Library list', () => {
  it('shows the title and year, a line on why the Title is in its state, a dot per Slot and the size', async () => {
    fakeLibrary([
      ...rows(),
      row(4, 'Amélie', 'Die fabelhafte Welt der Amélie', {
        year: 2001,
        size: 8 * 1024 ** 3,
        wanted_since: null,
        added_at: '2025-01-01T00:00:00Z',
        slots: { standard: { version_id: 41, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null },
      }),
    ])
    const list = await openLibrary()

    const first = await within(list).findByRole('option', { name: /paddington/i })
    expect(first).toHaveTextContent('Paddington2014')
    // One Version of two is Wanted: the line names its Slot, and says Kestrel has not looked yet.
    expect(first.querySelector('[data-state-line]')).toHaveTextContent(/^Standard Wanted for .* · not searched yet$/)
    // One phrase per row, and the dots inside are hidden from the accessibility tree.
    const dots = within(first).getByRole('img', { name: 'Standard: Wanted, 4K: Filled' })
    expect(dots.children).toHaveLength(2)
    for (const dot of Array.from(dots.children)) expect(dot).toHaveAttribute('aria-hidden', 'true')
    // The row is named once: no dot carries a title of its own.
    for (const dot of Array.from(dots.children)) expect(dot).not.toHaveAttribute('title')

    // A Title that wants nothing says what it holds: here its Primary-Language title, and its size.
    const amelie = within(list).getByRole('option', { name: /amélie/i })
    expect(amelie.querySelector('[data-state-line]')).toHaveTextContent('Die fabelhafte Welt der Amélie')
    expect(amelie).toHaveTextContent('8.0 GB')
    expect(screen.getByText('4 of 4 · 8.0 GB')).toBeInTheDocument()
  })

  it('shows a tick box on every row, out of the Tab order', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    const boxes = await within(list).findAllByRole('checkbox', { name: /^Tick / })
    expect(boxes).toHaveLength(3)
    for (const b of boxes) expect(b).toHaveAttribute('tabindex', '-1')
  })

  it('is driven by j and k, the arrow keys and Enter', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(selected()).toHaveTextContent('Paddington')

    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('Heat')
    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('j') // clamped at the end
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('k')
    expect(selected()).toHaveTextContent('Heat')
    await userEvent.keyboard('{ArrowUp}')
    expect(selected()).toHaveTextContent('Paddington')
    await userEvent.keyboard('k') // clamped at the start
    expect(selected()).toHaveTextContent('Paddington')

    // Enter moves into the detail pane, Escape back to the list.
    await userEvent.keyboard('{Enter}')
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(pane).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(list).toHaveFocus()
    await userEvent.keyboard('j')
    expect(selected()).toHaveTextContent('Heat')
  })

  it('marks the cursor option with aria-current and scrolls it into view as j and k move it', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fakeLibrary(rows())
    const list = await openLibrary()
    const options = await within(list).findAllByRole('option')
    const current = () => document.querySelector('[aria-current="true"]')

    expect(current()).toBe(options[0])
    await userEvent.keyboard('j')
    expect(current()).toBe(options[1])
    expect(current()).toBe(selected())
    expect(scroll.mock.contexts.at(-1)).toBe(options[1])
    await userEvent.keyboard('k')
    expect(current()).toBe(options[0])
  })

  it('is one Tab stop, and a click on a row selects it', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    const options = await within(list).findAllByRole('option')
    expect(list).toHaveFocus()
    expect(within(list).queryAllByRole('button')).toHaveLength(0)

    await userEvent.tab()
    expect(list).not.toHaveFocus()
    expect(list.contains(document.activeElement)).toBe(false)

    await userEvent.click(options[2])
    expect(selected()).toHaveTextContent('Zodiac')
    expect(list).toHaveFocus()
  })

  it('filters from the keyboard: / focuses the filter, arrows keep moving, Escape clears it', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')

    await userEvent.keyboard('/')
    const field = filter()
    expect(field).toHaveFocus()
    await userEvent.keyboard('o') // Heat has no o; Paddington and Zodiac do
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toHaveTextContent('Zodiac')
    await userEvent.keyboard('{Escape}')
    expect(field).toHaveValue('')
    expect(within(list).getAllByRole('option')).toHaveLength(3)
    expect(list).toHaveFocus()
  })

  it('filters by the Primary-Language title too', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    await userEvent.type(filter(), 'bär')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(selected()).toHaveTextContent('Paddington')
  })

  it('says so when the Library is empty and offers to add', async () => {
    fakeLibrary([])
    await openLibrary()
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add a title/i }))
    expect(await screen.findByRole('dialog', { name: /command menu/i })).toBeInTheDocument()
  })

  it('shows the key hints in the footer and the count at the end of the screen bar', async () => {
    fakeLibrary(rows())
    await openLibrary()

    const count = await screen.findByText('3 of 3')
    expect(count.closest('footer')).not.toBeInTheDocument()
    expect(within(screen.getByRole('contentinfo')).getByText('j')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter the Library' }).compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the Library filter', () => {
  it('narrows by kind:', async () => {
    fakeLibrary([...rows(), row(4, 'Breaking Bad', 'Breaking Bad', { kind: 'series' })])
    const list = await openLibrary()
    await within(list).findAllByRole('option')

    await userEvent.type(filter(), 'kind:series ')
    expect(shown(list)).toEqual([expect.stringContaining('Breaking Bad')])
  })

  it('gives the arrows and Enter to the suggestions while they are open, and to the list again after', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    const user = userEvent.setup()

    await user.keyboard('/')
    await user.keyboard('slot:')
    const suggestions = await screen.findByRole('listbox', { name: 'Suggestions' })
    await user.keyboard('{ArrowDown}')
    expect(within(suggestions).getByRole('option', { selected: true })).toHaveTextContent('4k')
    expect(within(list).getByRole('option', { selected: true })).toHaveTextContent('Paddington') // the list stays put
    await user.keyboard('{Enter}')
    expect(filter()).toHaveValue('slot:4k')
    expect(filter()).toHaveFocus()

    await user.keyboard(' ')
    await user.keyboard('{Escape}') // clears the filter and steps back to the list
    expect(filter()).toHaveValue('')
    expect(list).toHaveFocus()
  })

  it('explains its qualifiers behind "?"', async () => {
    fakeLibrary(rows())
    await openLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Query Help' }))
    const help = screen.getByRole('dialog', { name: 'Query Help' })
    for (const q of ['kind:', 'is:', 'slot:', 'profile:', 'sort:']) expect(within(help).getByText(q)).toBeInTheDocument()
  })

  it('keeps the filter in the address bar', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')

    await userEvent.type(filter(), 'is:wanted pad')
    expect(location.pathname).toBe('/library')
    expect(new URLSearchParams(location.search).get('q')).toBe('is:wanted pad')
    expect(shown(list)).toEqual([expect.stringContaining('Paddington')])
  })

  it('opens a bookmarked, filtered Library', async () => {
    fakeLibrary(rows())
    history.replaceState(null, '', '/library?q=slot%3A4k')
    renderApp()

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(await screen.findByRole('combobox', { name: 'Filter the Library' })).toHaveValue('slot:4k')
    await within(list).findAllByRole('option')
    expect(shown(list)).toEqual([expect.stringContaining('Paddington')])
  })
})

describe('the Library detail pane', () => {
  it('shows a Version row per Slot with Profile and status', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })

    expect(await within(pane).findByRole('heading', { name: 'Paddington' })).toBeInTheDocument()
    expect(pane).toHaveTextContent('Ein Bär namens Paddington')
    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    const uhd = within(pane).getByRole('listitem', { name: '4K' })
    expect(await within(hd).findByText('Any')).toBeInTheDocument() // the Profile's name arrives with GET /profiles
    expect(hd).toHaveTextContent('Wanted')
    expect(uhd).toHaveTextContent('4K')
    expect(uhd).toHaveTextContent('Filled')
  })

  it('follows the selection', async () => {
    fakeLibrary(rows())
    await openLibrary()
    await screen.findByRole('heading', { name: 'Paddington' })
    await userEvent.keyboard('j')
    expect(await screen.findByRole('heading', { name: 'Heat' })).toBeInTheDocument()
  })

  it('says who requested the Title and from where', async () => {
    fakeLibrary(rows())
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(rows()[0], { requests: [{ id: 5, source: 'silo', requester_name: 'Anna', created_at: '2026-10-01T10:00:00Z' }] }))))
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(await within(pane).findByText('Requested by Anna via Silo')).toBeInTheDocument()
  })

  it('shows the poster when the Title has one', async () => {
    fakeLibrary(rows())
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(rows()[0], { has_poster: true }))))
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(await within(pane).findByRole('img', { name: /poster/i })).toHaveAttribute('src', expect.stringContaining('/titles/1/poster'))
  })

  it("shows a Version's file with its quality, probed languages and Score", async () => {
    fakeLibrary(rows())
    const d = detail(rows()[0])
    const hd = d.versions.find((v) => v.slot === 'standard')!
    hd.state = 'filled'
    hd.file = {
      path: '/data/media/movies/P/P.mkv',
      size: 8 << 30,
      release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
      score: 1750,
      quality: 'Bluray-1080p',
      languages: ['English', 'German'],
      imported_at: '2026-10-17T12:00:00Z',
    }
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(d)))
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })
    expect(await within(pane).findByText(/Bluray-1080p · English \+ German · .*Score 1750/)).toBeInTheDocument()
    // The row names the file on disk, not the release it was grabbed as.
    expect(within(pane).getByRole('button', { name: 'P.mkv' })).toBeInTheDocument()
    expect(within(pane).queryByText('Paddington.2014.1080p.BluRay.x264-GRP')).not.toBeInTheDocument()
  })

  it("opens the Movie's file popover from the file name: full path, Copy path and the release name", async () => {
    fakeLibrary(rows())
    const d = detail(rows()[0])
    const hd = d.versions.find((v) => v.slot === 'standard')!
    hd.state = 'filled'
    hd.file = {
      path: '/data/media/movies/P/P.mkv',
      size: 8 << 30,
      release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
      score: 1750,
      imported_at: '2026-10-17T12:00:00Z',
    }
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(d)))
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })

    await userEvent.click(await within(pane).findByRole('button', { name: 'P.mkv' }))

    const popover = await screen.findByRole('dialog', { name: 'Standard file' })
    expect(popover).toHaveTextContent('/data/media/movies/P/P.mkv')
    expect(popover).toHaveTextContent('Grabbed as Paddington.2014.1080p.BluRay.x264-GRP')
    expect(within(popover).getByRole('button', { name: 'Copy to Clipboard' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Standard file' })).not.toBeInTheDocument())
  })
})

describe('the Library list posters', () => {
  it('shows a Title its poster, and the placeholder without a request when it has none', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington', { has_poster: true }), row(2, 'Heat', 'Heat', { has_poster: false })])
    const list = await openLibrary()

    const withPoster = await within(list).findByRole('option', { name: /paddington/i })
    const without = within(list).getByRole('option', { name: /heat/i })
    expect(withPoster.querySelector('[data-poster] img')).toHaveAttribute('src', expect.stringMatching(/\/titles\/1\/poster$/))
    expect(without.querySelector('[data-poster]')).toBeInTheDocument()
    expect(without.querySelector('[data-poster] img')).not.toBeInTheDocument()
  })

  it('reserves a poster box in each loading row', async () => {
    server.use(http.get('/titles', () => new Promise(() => {})))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(list.querySelectorAll('[style*="width: 32px"][style*="height: 48px"]')).toHaveLength(8)
  })
})

describe('the Library state tabs and sort', () => {
  it('sorts by name, year and size both ways, from the address bar too', async () => {
    fakeLibrary([row(1, 'Zodiac', 'Zodiac', { year: 2007, size: 2 }), row(2, 'alien', 'alien', { year: 1979, size: 3 }), row(3, 'Heat', 'Heat', { year: 1995, size: 1 })])
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    const order = () =>
      within(list)
        .getAllByRole('option')
        .map((o) => o.querySelector('[data-title]')?.textContent)
    expect(order()).toEqual(['Zodiac', 'alien', 'Heat']) // as added

    await userEvent.click(screen.getByRole('button', { name: /^Sort/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Name A–Z' }))
    expect(filter()).toHaveValue('sort:name-asc')
    expect(order()).toEqual(['alien', 'Heat', 'Zodiac'])
    expect(new URLSearchParams(location.search).get('q')).toBe('sort:name-asc')

    await userEvent.clear(filter())
    await userEvent.type(filter(), 'sort:year-asc')
    expect(order()).toEqual(['alien', 'Heat', 'Zodiac'])
    await userEvent.clear(filter())
    await userEvent.type(filter(), 'sort:size-desc')
    expect(order()).toEqual(['alien', 'Zodiac', 'Heat'])
  })
})

describe('the Library grid', () => {
  it('switches with g, remembers it, and sums up the picked Title in a panel', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked()

    await userEvent.keyboard('g')
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked()
    expect(localStorage.getItem('kestrel.library.view')).toBe('grid')
    const grid = screen.getByRole('listbox', { name: 'Library' })
    expect(within(grid).getAllByRole('option')).toHaveLength(3)
    expect(screen.queryByRole('region', { name: /paddington/i })).not.toBeInTheDocument() // no Title pane beside the grid

    await userEvent.keyboard('j')
    await userEvent.keyboard('{Enter}')
    const panel = await screen.findByRole('complementary', { name: 'Heat summary' })
    expect(await within(panel).findByRole('listitem', { name: 'Standard' })).toHaveTextContent('Wanted')
    expect(within(panel).getByText('Not searched yet')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Open Title' }))
    expect(await screen.findByRole('region', { name: 'Heat' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(within(screen.getByRole('listbox', { name: 'Library' })).getAllByRole('option')).toHaveLength(3)

    localStorage.removeItem('kestrel.library.view')
  })

  it('opens in the view last used', async () => {
    localStorage.setItem('kestrel.library.view', 'grid')
    fakeLibrary(rows())
    await openLibrary()
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked()
    localStorage.removeItem('kestrel.library.view')
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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
const shown = (list: HTMLElement) => within(list).queryAllByRole('option').map((o) => o.querySelector('.truncate')?.firstChild?.textContent)


describe('the Library list', () => {
  it('shows the English title, the Primary-Language title and a dot per Slot', async () => {
    fakeLibrary(rows())
    const list = await openLibrary()

    const first = await within(list).findByRole('option', { name: /paddington/i })
    expect(first).toHaveTextContent('Paddington')
    expect(first).toHaveTextContent('Ein Bär namens Paddington')
    expect(within(first).getByRole('img', { name: 'Standard: Wanted' })).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: '4K: Filled' })).toBeInTheDocument()

    // The second line is only for a Primary-Language title that differs.
    const heat = within(list).getByRole('option', { name: /heat/i })
    expect(heat.querySelectorAll('[data-primary-title]')).toHaveLength(0)
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

  it('hides the key hints on touch screens but keeps the count', async () => {
    fakeLibrary(rows())
    await openLibrary()

    const count = await screen.findByText('3 of 3')
    const footer = count.closest('footer')
    expect(footer).toBeInTheDocument()
    expect(within(footer!).getByText('j').closest('.pointer-coarse\\:hidden')).toBeInTheDocument()
    expect(count).not.toHaveClass('pointer-coarse:hidden')
  })
})

describe('the Library filter', () => {
  it('narrows by kind:', async () => {
    fakeLibrary([...rows(), row(4, 'Breaking Bad', 'Breaking Bad', { kind: 'series' })])
    const list = await openLibrary()
    await within(list).findAllByRole('option')

    await userEvent.type(filter(), 'kind:series ')
    expect(shown(list)).toEqual(['Breaking Bad'])
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
    expect(shown(list)).toEqual(['Paddington'])
  })

  it('opens a bookmarked, filtered Library', async () => {
    fakeLibrary(rows())
    history.replaceState(null, '', '/library?q=slot%3A4k')
    renderApp()

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(await screen.findByRole('combobox', { name: 'Filter the Library' })).toHaveValue('slot:4k')
    await within(list).findAllByRole('option')
    expect(shown(list)).toEqual(['Paddington'])
  })
})

describe('the Library detail pane', () => {
  it('shows a Version row per Slot with Profile and status', async () => {
    fakeLibrary(rows())
    await openLibrary()
    const pane = await screen.findByRole('region', { name: /paddington/i })

    expect(await within(pane).findByRole('heading', { name: 'Paddington' })).toBeInTheDocument()
    expect(pane).toHaveTextContent('Ein Bär namens Paddington')
    const hd = within(pane).getByRole('group', { name: 'Standard' })
    const uhd = within(pane).getByRole('group', { name: '4K' })
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
    server.use(
      http.get('/titles/{id}', ({ response }) =>
        response(200).json(detail(rows()[0], { requests: [{ id: 5, source: 'silo', requester_name: 'Anna', created_at: '2026-10-01T10:00:00Z' }] })),
      ),
    )
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
    expect(within(popover).getByRole('button', { name: 'Copy path' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Standard file' })).not.toBeInTheDocument())
  })
})

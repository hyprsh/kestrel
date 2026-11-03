import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'
import { fakeTmdb, openMenu, renderApp, result } from './testkit'

/** Opens the menu and types the query. */
async function search(q = 'padd') {
  const menu = await openMenu()
  await userEvent.keyboard(q)
  return menu
}

/** The second line of a row: what a Title or command is, under its name. */
const second = (option: HTMLElement) => option.querySelector('[data-row] > span:nth-child(2)')?.textContent

/** TMDB's results: the last group, which the Library's own Titles and the commands come before. */
const foundGroup = (menu: HTMLElement) => within(menu).getAllByRole('group').at(-1)!

describe('the command menu', () => {
  it('shows a loading line with a spinner only after a short wait', async () => {
    fakeLibrary([])
    let answer: () => void = () => {}
    const gate = new Promise<void>((resolve) => (answer = resolve))
    server.use(
      http.get('/lookup', async ({ response }) => {
        await gate
        return response(200).json({ items: [], next_cursor: null, did_you_mean: null })
      }),
    )
    renderApp()
    const menu = await search('qqzxv')
    expect(within(menu).queryByText('Searching…')).not.toBeInTheDocument()
    expect(await within(menu).findByText('Searching…', {}, { timeout: 2000 })).toBeInTheDocument()
    answer()
  })

  it('opens with the shortcut, navigates anywhere and closes with Escape', async () => {
    fakeLibrary([])
    renderApp()
    const menu = await openMenu()
    expect(within(menu).getByRole('option', { name: /library/i })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.keyboard('{Control>}k{/Control}')
    const again = await screen.findByRole('dialog')
    await userEvent.keyboard('upcom')
    // Enter picks the first row, so wait for the list to have settled on Upcoming before pressing it.
    await within(again).findByRole('option', { name: /^Upcoming/ })
    await userEvent.keyboard('{Enter}') // first match is Go To > Upcoming
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Upcoming', level: 1 })).toBeInTheDocument()
  })

  it('lists Recent Titles with their state, then Actions, then Go To', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat', { year: 1995 }), row(2, 'Zodiac', 'Zodiac')])
    renderApp()
    const menu = await openMenu()
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Recent', 'Actions', 'Go To'])
    const heat = await within(menu).findByRole('option', { name: /^Heat/ })
    expect(heat).toHaveTextContent('1995')
    expect(second(heat)).toMatch(/^Movie · /)
    const add = within(menu).getByRole('option', { name: /^Add Title…/ })
    expect(second(add)).toBe('Search TMDB for a Movie or Series')
  })

  it('draws every row at one height, 52px and 56px on a phone, whatever the row holds', async () => {
    fakeTmdb()
    renderApp()
    const menu = await openMenu()
    const sameHeight = () => {
      const options = within(menu).getAllByRole('option')
      expect(options.length).toBeGreaterThan(3)
      // chrome-ok: jsdom draws no layout, so the one height is asserted through the row's height classes
      for (const o of options) expect(o).toHaveClass('h-13', 'max-sm:h-14')
    }
    sameHeight() // Titles, Actions and Go To
    await userEvent.keyboard('padd')
    await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    sameHeight() // and TMDB's results among them
  })

  it('shows a key hint footer on a desktop', async () => {
    fakeLibrary([])
    renderApp()
    const menu = await openMenu()
    expect(within(menu).getByText('Move')).toBeInTheDocument()
    expect(within(menu).getByText('Open')).toBeInTheDocument()
  })

  it('opens Add Title… as a search of TMDB alone, with its hint as the placeholder', async () => {
    fakeTmdb()
    renderApp()
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('option', { name: /add title/i }))
    const input = within(menu).getByRole('combobox', { name: /search/i })
    expect(input).toHaveAttribute('placeholder', 'Type a title to search both Movies and Series…')
    expect(within(menu).queryByRole('option', { name: /^Library/ })).not.toBeInTheDocument()
    await userEvent.keyboard('padd')
    expect(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.keyboard('{Backspace}')
    expect(await within(menu).findByRole('option', { name: /^Library/ })).toBeInTheDocument() // Backspace on an empty field leaves Add mode
  })

  it('moves the highlight with Ctrl+N and Ctrl+P as well as the arrows', async () => {
    fakeLibrary([])
    renderApp()
    const menu = await openMenu()
    const selected = () => within(menu).getByRole('option', { selected: true })
    const first = selected()
    await userEvent.keyboard('{Control>}n{/Control}')
    expect(selected()).not.toBe(first)
    await userEvent.keyboard('{Control>}p{/Control}')
    expect(selected()).toBe(first)
  })

  it('finds Titles already in the Library by name', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat'), row(2, 'Zodiac', 'Zodiac')])
    renderApp()
    const menu = await openMenu()
    await userEvent.keyboard('zod')
    await userEvent.click(await within(menu).findByRole('option', { name: /zodiac/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /zodiac/i, selected: true })).toBeInTheDocument()
  })

  it('searches the Library, the commands and TMDB together, TMDB last', async () => {
    fakeTmdb()
    renderApp()
    const menu = await search('padd')
    await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent).at(-1)).toBe('Add a Title')
    const found = within(groups.at(-1)!).getAllByRole('option')
    expect(found.map((o) => o.querySelector('[data-row]')?.firstElementChild?.textContent)).toEqual(['Paddington 2014', 'Paddington Returns 2014', 'Breaking Bad 2008'])
  })

  it('finds Titles fuzzily, best match first', async () => {
    fakeLibrary([row(1, 'Bad Boys', 'Bad Boys'), row(2, 'Breaking Bad', 'Breaking Bad'), row(3, 'Amélie', 'Amélie'), row(4, 'Spider-Man', 'Spider-Man')])
    renderApp()
    const menu = await openMenu()
    const input = within(menu).getByRole('combobox', { name: /search/i })
    const libraryTitles = ['Bad Boys', 'Breaking Bad', 'Amélie', 'Spider-Man']
    const titles = () =>
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent ?? '')
        .filter((name) => libraryTitles.some((t) => name.startsWith(t)))
        .map((name) => libraryTitles.find((t) => name.startsWith(t)))

    await userEvent.keyboard('bb')
    await waitFor(() => expect(titles()).toEqual(['Bad Boys', 'Breaking Bad'])) // initials of both, the shorter first

    await userEvent.clear(input)
    await userEvent.keyboard('bad breaking')
    await waitFor(() => expect(titles()).toEqual(['Breaking Bad'])) // words in any order

    await userEvent.clear(input)
    await userEvent.keyboard('amelie')
    await waitFor(() => expect(titles()).toEqual(['Amélie']))

    await userEvent.clear(input)
    await userEvent.keyboard('spiderman')
    await waitFor(() => expect(titles()).toEqual(['Spider-Man']))

    await userEvent.clear(input)
    await userEvent.keyboard('brekaing')
    await waitFor(() => expect(titles()).toEqual(['Breaking Bad'])) // a typo

    await userEvent.keyboard('{Enter}') // the best match is selected
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /breaking bad/i, selected: true })).toBeInTheDocument()
  })

  it('puts the group with the best match first, and ranks inside each group', async () => {
    fakeLibrary([row(1, 'Logan', 'Logan'), row(2, 'Overboard Again', 'Overboard Again')])
    renderApp()
    const menu = await openMenu()
    const input = within(menu).getByRole('combobox', { name: /search/i })
    const groups = () =>
      within(menu)
        .getAllByRole('group')
        .map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)

    await userEvent.keyboard('log')
    await within(menu).findByRole('option', { name: /^logan/i })
    expect(groups().slice(0, 2)).toEqual(['Go To', 'Titles']) // the place Log is exact, Logan only starts with it
    expect(within(menu).getAllByRole('option')[0]).toHaveAccessibleName(/^log$/i)

    await userEvent.clear(input)
    await userEvent.keyboard('logan')
    await within(menu).findByRole('option', { name: /^logan/i })
    expect(groups()[0]).toBe('Titles')

    await userEvent.clear(input)
    await userEvent.keyboard('ov')
    await within(menu).findByRole('option', { name: /overboard/i })
    expect(groups().slice(0, 2)).toEqual(['Go To', 'Titles']) // Overview is the shorter
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /overboard/i, selected: true })).toBeInTheDocument()
  })

  it('shows a Library Title with its poster, or an empty frame when it has none', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat', { has_poster: true }), row(2, 'Heatwave', 'Heatwave')])
    renderApp()
    const menu = await openMenu()
    await userEvent.keyboard('heat')

    const withPoster = await within(menu).findByRole('option', { name: /^heat\b(?!wave)/i })
    expect(withPoster.querySelector('[data-poster] img')).toHaveAttribute('src', expect.stringMatching(/\/titles\/1\/poster$/))
    const without = within(menu).getByRole('option', { name: /heatwave/i })
    expect(without.querySelector('[data-poster]')).toBeInTheDocument()
    expect(without.querySelector('[data-poster] img')).toBeNull() // no request that would 404
  })

  it('tells results apart on their second line: kind, network or studio, country, seasons or runtime and the score with its votes', async () => {
    const f = fakeTmdb()
    renderApp()
    const menu = await search('padd')
    const movie = await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    expect(second(movie)).toBe('Movie · Heyday Films · United Kingdom · 1 h 35 min · TMDB 7.3 from 4,912 votes')
    expect(second(within(menu).getByRole('option', { name: /^Breaking Bad/ }))).toBe('Series · AMC · United States · 5 seasons · TMDB 8.9 from 14,523 votes')
    expect(f.queries.at(-1)).toBe('padd')
  })

  it('marks a Movie already in the Library and opens it instead of adding it', async () => {
    const f = fakeTmdb()
    renderApp()
    const menu = await search('padd')
    await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    const owned = within(foundGroup(menu)).getByRole('option', { name: /paddington returns/i })
    expect(owned).toHaveTextContent('In Library')
    await userEvent.click(owned)

    expect(f.sent).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /paddington returns/i, selected: true })).toBeInTheDocument()
  })

  it('greys out a Series TheTVDB does not have, and says so', async () => {
    fakeLibrary([])
    server.use(
      http.get('/lookup', ({ response }) =>
        response(200).json({ items: [result(5, 'Lost Show', { kind: 'series', addable: false, not_addable_reason: 'not_on_tvdb' })], next_cursor: null, did_you_mean: null }),
      ),
    )
    renderApp()
    const menu = await search('lost show')
    const option = await within(menu).findByRole('option', { name: /lost show/i })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).toHaveTextContent('Not on TheTVDB')
  })

  it('offers the best result as the query when it differs a lot from what was typed', async () => {
    fakeLibrary([])
    const queries: string[] = []
    server.use(
      http.get('/lookup', ({ request, response }) => {
        const q = new URL(request.url).searchParams.get('q') ?? ''
        queries.push(q)
        return response(200).json({
          items: [result(329, 'Jurassic Park'), result(330, 'The Lost World: Jurassic Park')],
          next_cursor: null,
          did_you_mean: q === 'qzx prak' ? 'Jurassic Park' : null,
        })
      }),
    )
    renderApp()
    const menu = await search('qzx prak')

    const suggestion = await within(menu).findByRole('option', { name: 'Did you mean Jurassic Park?' })
    expect(suggestion).toHaveAttribute('aria-selected', 'true') // first, so Enter runs it
    await userEvent.keyboard('{Enter}')

    expect(within(menu).getByRole('combobox', { name: /search/i })).toHaveValue('Jurassic Park')
    await waitFor(() => expect(queries.at(-1)).toBe('Jurassic Park'))
    await waitFor(() => expect(within(menu).queryByRole('option', { name: /did you mean/i })).not.toBeInTheDocument())
    expect(within(menu).getByRole('option', { name: /^jurassic park/i })).toBeInTheDocument()
  })

  it('says why a search failed', async () => {
    fakeLibrary([])
    server.use(
      http.get('/lookup', ({ response }) =>
        response('default').json(
          { type: 'about:blank', title: 'bad gateway', status: 502, code: 'upstream_unavailable', detail: 'The metadata provider refused or lacks an API key' },
          { status: 502 },
        ),
      ),
    )
    renderApp()
    await search('qqzxv')
    expect(await screen.findByRole('alert')).toHaveTextContent(/API key/)
  })
})

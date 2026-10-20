import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type LookupResult, type Sent, type Suggestion } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const result = (id: number, title: string, over: Partial<LookupResult> = {}): LookupResult => ({
  kind: 'movie',
  tmdb_id: id,
  tvdb_id: null,
  title,
  year: 2014,
  poster: null,
  in_library: null,
  addable: true,
  not_addable_reason: null,
  ratings: [],
  ...over,
})

const defaultSuggestion = (id: number, title: string): Suggestion => ({
  kind: 'movie',
  tmdb_id: id,
  title,
  year: 2014,
  overview: '',
  in_library: null,
  certification: '6',
  certification_country: 'DE',
  slots: [{ slot: 'standard', profile: 'hd-primary', label: 'HD', reason: 'default' }],
  ratings: [],
  poster: null,
  runtime: null,
  genres: [],
})

/** TMDB lookups: Paddington is addable, Paddington Returns is already in the Library. */
function fakeLookup(suggestion: (id: number, title: string) => Suggestion = defaultSuggestion) {
  const lib = fakeLibrary([row(7, 'Paddington Returns', 'Paddington 2')])
  const sent: Sent[] = []
  const queries: string[] = []
  server.use(
    http.get('/lookup', ({ request, response }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      queries.push(q)
      return response(200).json({
        items: [result(116149, 'Paddington'), result(346648, 'Paddington Returns', { in_library: 7 })],
        next_cursor: null,
      })
    }),
    http.get('/lookup/{kind}/{tmdb_id}', ({ params, response }) =>
      response(200).json(suggestion(Number(params.tmdb_id), Number(params.tmdb_id) === 116149 ? 'Paddington' : 'Paddington Returns')),
    ),
    http.post('/titles', async ({ request, response }) => {
      const body = await request.json()
      sent.push({ path: 'titles', body })
      const added = row(8, 'Paddington', 'Ein Bär namens Paddington', { slots: { standard: { version_id: 81, profile: 'hd-primary', state: 'wanted', long_missing: false }, '4k': null } })
      lib.rows = [added, ...lib.rows]
      return response(201).json(detail(added))
    }),
  )
  return { sent, queries }
}

const openMenu = async () => {
  await screen.findByRole('navigation')
  await userEvent.keyboard('{Control>}k{/Control}')
  return screen.findByRole('dialog', { name: /command menu/i })
}

/** Opens the menu in Add mode and searches. */
async function searchForPaddington() {
  const menu = await openMenu()
  await userEvent.keyboard('padd')
  await userEvent.click(await within(menu).findByRole('option', { name: /add "padd"/i }))
  return menu
}

describe('the command menu', () => {
  it('opens with the shortcut, navigates anywhere and closes with Escape', async () => {
    fakeLibrary([])
    renderApp()
    const menu = await openMenu()
    expect(within(menu).getByRole('option', { name: /library/i })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog')
    await userEvent.keyboard('upcom{Enter}') // first match is Go to > Upcoming
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Upcoming')
  })

  it('finds Titles already in the Library by name', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat'), row(2, 'Zodiac', 'Zodiac')])
    renderApp()
    const menu = await openMenu()
    await userEvent.keyboard('zod')
    await userEvent.click(await within(menu).findByRole('option', { name: /zodiac/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Library')
    expect(await screen.findByRole('option', { name: /zodiac/i, selected: true })).toBeInTheDocument()
  })

  it('searches once across both kinds, marking a Movie already in the Library', async () => {
    const f = fakeLookup()
    renderApp()
    const menu = await searchForPaddington()

    const fresh = await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ })
    expect(fresh).toHaveTextContent('Movie')
    expect(fresh).not.toHaveTextContent('In library')
    const owned = within(menu).getByRole('option', { name: /paddington returns/i })
    expect(owned).toHaveTextContent('In library')
    expect(f.queries.at(-1)).toBe('padd')
  })

  it('adds a Movie with the Slots preselected and the default named as the reason', async () => {
    const f = fakeLookup()
    renderApp()
    const menu = await searchForPaddington()
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))

    expect(await within(menu).findByText('Preselected: Standard · HD (default)')).toBeInTheDocument()
    expect(within(menu).getByRole('checkbox', { name: 'Standard' })).toBeChecked()
    expect(within(menu).getByRole('checkbox', { name: '4K' })).not.toBeChecked()
    expect(within(menu).getByRole('combobox', { name: 'Standard Profile' })).toHaveValue('hd-primary')

    await userEvent.keyboard('{Enter}') // one key confirms

    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({ kind: 'movie', tmdb_id: 116149, versions: [{ slot: 'standard', profile: 'hd-primary' }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('banner')).toHaveTextContent('Library')
    expect(await screen.findByRole('option', { name: /paddington/i, selected: true })).toBeInTheDocument()
  })

  it('lets the Slots and Profiles be changed before adding', async () => {
    const f = fakeLookup()
    renderApp()
    const menu = await searchForPaddington()
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
    await within(menu).findByText(/Preselected/)

    await userEvent.selectOptions(within(menu).getByRole('combobox', { name: 'Standard Profile' }), 'hd-primary')
    await userEvent.click(within(menu).getByRole('checkbox', { name: '4K' }))
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))

    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({
      kind: 'movie',
      tmdb_id: 116149,
      versions: [
        { slot: 'standard', profile: 'hd-primary' },
        { slot: '4k', profile: '4k-primary' },
      ],
    })
  })

  it('preselects the first root folder and lets another be picked', async () => {
    const f = fakeLookup()
    server.use(
      http.get('/settings', ({ response }) =>
        response(200).json({
          language_region: { primary_language: 'en', release_date_country: 'US' },
          check_github_updates: true,
          pause_grabs: false,
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false },
          trash: { auto_update: true },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
          root_folders: { movies: ['/data/movies', '/data/more-movies'], series: ['/data/tv'] },
        }),
      ),
    )
    renderApp()
    const menu = await searchForPaddington()
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
    await within(menu).findByText(/Preselected/)

    const folder = within(menu).getByRole('combobox', { name: 'Root folder' })
    expect(folder).toHaveValue('/data/movies')
    await userEvent.selectOptions(within(menu).getByRole('combobox', { name: 'Standard Profile' }), 'any-primary')
    expect(folder).toHaveValue('/data/movies') // no Profile moves the folder

    await userEvent.selectOptions(folder, '/data/more-movies')
    await userEvent.click(within(menu).getByRole('button', { name: /^add/i }))
    await waitFor(() => expect(f.sent).toHaveLength(1))
    expect(f.sent[0].body).toEqual({ kind: 'movie', tmdb_id: 116149, versions: [{ slot: 'standard', profile: 'any-primary' }], root_folder: '/data/more-movies' })
  })

  it('does not add an already-added Movie: it opens it in the Library', async () => {
    const f = fakeLookup()
    renderApp()
    const menu = await searchForPaddington()
    await userEvent.click(await within(menu).findByRole('option', { name: /paddington returns/i }))

    expect(f.sent).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('banner')).toHaveTextContent('Library')
    expect(await screen.findByRole('option', { name: /paddington returns/i, selected: true })).toBeInTheDocument()
  })

  it('steps back from the panel with Escape and from Add mode with Backspace', async () => {
    fakeLookup()
    renderApp()
    const menu = await searchForPaddington()
    await userEvent.click(await within(menu).findByRole('option', { name: /^Paddington\b(?!.*Returns)/ }))
    await within(menu).findByText(/Preselected/)

    await userEvent.keyboard('{Escape}')
    expect(await within(menu).findByRole('option', { name: /paddington returns/i })).toBeInTheDocument() // back to results
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const input = within(menu).getByRole('combobox', { name: /search/i })
    await userEvent.clear(input)
    await userEvent.keyboard('{Backspace}')
    expect(await within(menu).findByRole('option', { name: /library/i })).toBeInTheDocument() // root again
  })

  it('says why a search failed', async () => {
    fakeLibrary([])
    server.use(
      http.get('/lookup', ({ response }) =>
        response('default').json({ type: 'about:blank', title: 'bad gateway', status: 502, code: 'upstream_unavailable', detail: 'The metadata provider refused or lacks an API key' }, { status: 502 }),
      ),
    )
    renderApp()
    await searchForPaddington()
    expect(await screen.findByRole('alert')).toHaveTextContent(/API key/)
  })
})

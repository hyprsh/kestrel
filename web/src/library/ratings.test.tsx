import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { components } from '../api/schema.gen'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type LookupResult } from '../test/library'
import { server } from '../test/server'
import { ratingsText } from './Ratings'

type Rating = components['schemas']['Rating']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const tmdb = (value: number, votes: number, url = 'https://www.themoviedb.org/movie/116149'): Rating => ({ source: 'tmdb', value, scale: 10, votes, url })

describe("TMDB's audience rating", () => {
  it('reads as the source, the rating to one decimal and the votes, shortened', () => {
    expect(ratingsText([tmdb(8.4, 21345)])).toBe('TMDB 8.4 (21k)')
    expect(ratingsText([tmdb(7.25, 4912)])).toBe('TMDB 7.3 (4.9k)')
    expect(ratingsText([tmdb(6.9, 31)])).toBe('TMDB 6.9 (31)')
    expect(ratingsText([tmdb(9, 1000)])).toBe('TMDB 9.0 (1k)')
    expect(ratingsText([tmdb(8.9, 2_400_000)])).toBe('TMDB 8.9 (2.4M)')
    expect(ratingsText([{ source: 'tmdb', value: null, scale: 10, votes: 0, url: null }])).toBe('')
    expect(ratingsText([])).toBe('')
  })

  it("shows on the Title page's metadata line, linking to the Title on TMDB", async () => {
    const heat = row(1, 'Heat', 'Heat')
    fakeLibrary([heat])
    server.use(http.get('/titles/{id}', ({ response }) => response(200).json(detail(heat, { ratings: [tmdb(8.4, 21345, 'https://www.themoviedb.org/movie/949')] }))))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: 'Heat' })

    const link = await within(pane).findByRole('link', { name: 'TMDB 8.4 (21k)' })
    expect(link).toHaveAttribute('href', 'https://www.themoviedb.org/movie/949')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.parentElement).toHaveTextContent('2014 · 95 min · PG · Original EN · TMDB 8.4 (21k)')
  })

  it('shows in the Add Title results and the add panel', async () => {
    fakeLibrary([])
    const result = (id: number, title: string, ratings: Rating[]): LookupResult => ({
      kind: 'movie', tmdb_id: id, tvdb_id: null, title, year: 2014, poster: null, in_library: null, addable: true, not_addable_reason: null, ratings,
    })
    server.use(
      http.get('/lookup', ({ response }) =>
        response(200).json({ items: [result(116149, 'Paddington', [tmdb(7.3, 4912)]), result(5, 'Paddington Unrated', [])], next_cursor: null }),
      ),
      http.get('/lookup/{kind}/{tmdb_id}', ({ response }) =>
        response(200).json({
          kind: 'movie', tmdb_id: 116149, title: 'Paddington', year: 2014, overview: '', in_library: null, certification: null, certification_country: null,
          slots: [{ slot: 'standard', profile: 'hd-primary', label: 'HD', reason: 'default' }],
          ratings: [tmdb(7.3, 4912)],
          poster: null, runtime: null, genres: [],
        }),
      ),
    )
    renderApp()
    await screen.findByRole('navigation')
    await userEvent.keyboard('{Control>}k{/Control}')
    const menu = await screen.findByRole('dialog', { name: /command menu/i })
    await userEvent.keyboard('padd')
    await userEvent.click(await within(menu).findByRole('option', { name: /add "padd"/i }))

    const rated = await within(menu).findByRole('option', { name: /^Paddington 2014 · TMDB 7\.3 \(4\.9k\)/ })
    expect(within(menu).getByRole('option', { name: /Paddington Unrated/ })).not.toHaveTextContent('TMDB')

    await userEvent.click(rated)
    const link = await within(menu).findByRole('link', { name: 'TMDB 7.3 (4.9k)' })
    expect(link).toHaveAttribute('href', 'https://www.themoviedb.org/movie/116149')
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { cell, episode, fakeSeries } from '../test/series'
import { server } from '../test/server'

// Every accordion of a Title page starts closed, and each row's actions sit on its header: a text Button with the main action and a
// "<Row> Actions" menu on a wide screen, the menu alone on a phone, its first item the main action.

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** Opens the Title named `name` from the Library: the pane beside the list on a wide screen, a page of its own on a phone. */
async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  if (typeof window.matchMedia === 'function') await userEvent.click(await screen.findByRole('option', { name }))
  return screen.findByRole('region', { name })
}

const item = (scope: HTMLElement, name: RegExp) => within(scope).getByRole('button', { name }).closest('[role=listitem]') as HTMLElement
const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent)
const file = {
  path: '/data/media/movies/Paddington (2014)/Paddington (2014) - [Standard][WEBDL-1080p].mkv',
  size: 1.6 * 1024 ** 3,
  release_name: 'Paddington.2014.1080p.WEB-DL',
  score: 100,
  quality: 'WEBDL-1080p',
  video_codec: 'H.264',
  languages: ['English'],
  imported_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
}

/** A Series with a season of two Wanted episodes and a second one that is complete, so a row has something to search or nothing. */
function series() {
  const state = fakeSeries(false)
  state.get().episodes = [
    episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 100), '4k': cell('filled', 100) } }),
    episode(3, 2, 1, 'Seven Thirty-Seven', { cells: { standard: cell('wanted'), '4k': cell('filled', 100) } }),
  ]
  return state
}

function suite(phone: boolean) {
  it('starts a Series with every Version and Season closed', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    await within(pane).findByRole('region', { name: 'Seasons' })
    for (const r of within(pane).getAllByRole('button', { name: /^(Standard|4K|Season \d+):/ })) expect(r).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the season a link names, and the season of the episode found', async () => {
    series()
    history.replaceState(null, '', '/library?open=2')
    const pane = await openTitle(/breaking bad/i)
    expect(await within(pane).findByRole('button', { name: /^Season 2:/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(pane).getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a Movie Version the link names with ?slot=', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    history.replaceState(null, '', '/library?slot=standard')
    const pane = await openTitle(/paddington/i)
    expect(within(await within(pane).findByRole('region', { name: 'Versions' })).getByRole('button', { name: /^Standard:/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('puts a Season’s main action and menu on its header, with Select All, Monitor and the files', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    const seasons = await within(pane).findByRole('region', { name: 'Seasons' })
    const one = item(seasons, /^Season 1:/)
    const two = item(seasons, /^Season 2:/)
    const header = (li: HTMLElement) => li.firstElementChild as HTMLElement

    if (phone) {
      expect(within(one).queryByRole('button', { name: 'Search Season' })).not.toBeInTheDocument()
    } else {
      expect(within(header(two)).getByRole('button', { name: 'Search Season' })).toBeEnabled() // Season 2 has a Wanted episode
      expect(within(header(one)).getByRole('button', { name: 'Search Season' })).toBeDisabled() // Season 1 has none
      expect(within(header(two)).getByRole('button', { name: /^Season 2:/ })).not.toContainElement(within(header(two)).getByRole('button', { name: 'Search Season' }))
    }
    await userEvent.click(within(header(two)).getByRole('button', { name: 'Season 2 Actions' }))
    const menu = screen.getByRole('menu', { name: 'Season 2 Actions' })
    const rest = ['Manual Search Season Standard…', 'Manual Search Season 4K…', 'Select All of Season 2', 'Stop Monitoring Season 2']
    expect(names(menu).slice(0, phone ? 5 : 4)).toEqual(phone ? ['Search Season', ...rest] : rest)
    expect(within(two).queryByRole('region', { name: 'Season 2 episodes' })).not.toBeInTheDocument() // the row is still closed
  })

  it('ticks the episodes of a closed season from its menu, opening it', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    const seasons = await within(pane).findByRole('region', { name: 'Seasons' })
    await userEvent.click(within(item(seasons, /^Season 2:/)).getByRole('button', { name: 'Season 2 Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select All of Season 2' }))

    expect(within(seasons).getByRole('button', { name: /^Season 2:/ })).toHaveAttribute('aria-expanded', 'true')
    expect(await within(seasons).findByRole('checkbox', { name: 'Select Season 2 episode 1' })).toBeChecked()
  })

  it('puts a Series Version’s main action and menu on its header', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    const versions = await within(pane).findByRole('region', { name: 'Versions' })
    const std = item(versions, /^Standard:/)

    if (phone) expect(within(std).queryByRole('button', { name: 'Search Now' })).not.toBeInTheDocument()
    else expect(within(std).getByRole('button', { name: 'Search Now' })).toBeEnabled() // a Wanted episode
    await userEvent.click(within(std).getByRole('button', { name: 'Standard Actions' }))
    const got = names(screen.getByRole('menu', { name: 'Standard Actions' }))
    expect(got).toEqual(phone ? ['Search Now', 'Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Remove Version…'] : ['Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Remove Version…'])
  })

  it('puts a Movie Version’s main action and menu on its header, a Filled one searching for an Upgrade', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(row(1, 'Paddington', 'Paddington'))
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
      }),
    )
    const pane = await openTitle(/paddington/i)
    const std = item(await within(pane).findByRole('region', { name: 'Versions' }), /^Standard:/)

    if (phone) expect(within(std).queryByRole('button', { name: 'Search for Upgrade' })).not.toBeInTheDocument()
    else expect(within(std.firstElementChild as HTMLElement).getByRole('button', { name: 'Search for Upgrade' })).toBeEnabled()
    await userEvent.click(within(std).getByRole('button', { name: 'Standard Actions' }))
    const got = names(screen.getByRole('menu', { name: 'Standard Actions' }))
    expect(got).toEqual([...(phone ? ['Search for Upgrade'] : []), 'Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Delete Files…', 'Remove Version…'])
    await waitFor(() => expect(within(std).getByRole('button', { name: /^Standard:/ })).toHaveAttribute('aria-expanded', 'false'))
  })
}

describe('row actions on the Title page', suite.bind(null, false))

describe('row actions on the Title page, on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  suite(true)
})

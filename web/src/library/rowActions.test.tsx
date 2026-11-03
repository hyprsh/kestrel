import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { cell, episode, fakeSeries } from '../test/series'
import { server } from '../test/server'

// The Title page's Versions are cards (a Series' the column heads of its table) with a main Button and a "<Slot> Actions" menu; the
// seasons start closed and each row has a season-wide "<Season> Actions" menu.

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

/** Opens the Title named `name` from the Library: the pane beside the list on a wide screen, a page of its own on a phone. */
async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  if (typeof window.matchMedia === 'function') await userEvent.click(await screen.findByRole('option', { name }))
  return screen.findByRole('region', { name })
}

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
  /** A Series' Version card: a column head of the table on a wide screen, a card of the list above it on a phone. */
  const seriesCard = (scope: HTMLElement, name: string) =>
    phone ? within(within(scope).getByRole('list', { name: 'Versions' })).getByRole('listitem', { name }) : within(scope).getByRole('columnheader', { name })
  const seasonRow = (scope: HTMLElement, n: number) =>
    within(scope)
      .getByRole('button', { name: new RegExp(`^Season ${n}:`) })
      .closest('[role=row]') as HTMLElement

  it('starts a Series with every Season closed', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    await within(pane).findByRole('table', { name: 'Versions and seasons' })
    await within(pane).findAllByRole('button', { name: /^Season \d+:/ }, { timeout: 5000 })
    for (const r of within(pane).getAllByRole('button', { name: /^Season \d+:/ })) expect(r).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the season a link names, and the season of the episode found', async () => {
    series()
    history.replaceState(null, '', '/library?open=2')
    const pane = await openTitle(/breaking bad/i)
    expect(await within(pane).findByRole('button', { name: /^Season 2:/ }, { timeout: 5000 })).toHaveAttribute('aria-expanded', 'true')
    expect(within(pane).getByRole('button', { name: /^Season 1:/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('rings the Movie Version card the link names with ?slot=', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    history.replaceState(null, '', '/library?slot=standard')
    const pane = await openTitle(/paddington/i)
    expect(await within(pane).findByRole('listitem', { name: 'Standard' })).toHaveAttribute('data-current')
  })

  it('puts a Season’s menu on its row, season-wide: Search All Wanted, Select All, Monitor and the files', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    const table = await within(pane).findByRole('table', { name: 'Versions and seasons' })
    await within(table).findByRole('button', { name: /^Season 2:/ }, { timeout: 5000 })
    const two = seasonRow(table, 2)

    await userEvent.click(within(two).getByRole('button', { name: 'Season 2 Actions' }))
    const menu = screen.getByRole('menu', { name: 'Season 2 Actions' })
    expect(names(menu).slice(0, 3)).toEqual(['Search All Wanted in Season 2', 'Select All Episodes', 'Stop Monitoring Season 2'])
    expect(within(menu).getByRole('menuitem', { name: /^Delete Standard Season/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(seasonRow(table, 1)).getByRole('button', { name: 'Season 1 Actions' }))
    expect(within(screen.getByRole('menu', { name: 'Season 1 Actions' })).getByRole('menuitem', { name: /^Search All Wanted in Season 1/ })).toHaveAttribute('aria-disabled', 'true') // Season 1 has none
  })

  it('ticks the episodes of a closed season from its menu, opening it', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    const table = await within(pane).findByRole('table', { name: 'Versions and seasons' })
    await within(table).findByRole('button', { name: /^Season 2:/ }, { timeout: 5000 })
    await userEvent.click(within(seasonRow(table, 2)).getByRole('button', { name: 'Season 2 Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select All Episodes' }))

    expect(within(table).getByRole('button', { name: /^Season 2:/ })).toHaveAttribute('aria-expanded', 'true')
    expect(await within(table).findByRole('checkbox', { name: 'Select Season 2 episode 1' })).toBeChecked()
  })

  it('puts a Series Version’s main action and menu on its card', async () => {
    series()
    const pane = await openTitle(/breaking bad/i)
    await within(pane).findByRole('table', { name: 'Versions and seasons' })
    const std = seriesCard(pane, 'Standard')

    expect(within(std).getByRole('button', { name: 'Search Now' })).toBeEnabled() // a Wanted episode
    await userEvent.click(within(std).getByRole('button', { name: 'Standard Actions' }))
    expect(names(screen.getByRole('menu', { name: 'Standard Actions' }))).toEqual(['Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Remove Version…'])
  })

  it('puts a Movie Version’s main action and menu on its card, a Filled one searching for an Upgrade', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(row(1, 'Paddington', 'Paddington'))
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
      }),
    )
    const pane = await openTitle(/paddington/i)
    const std = await within(pane).findByRole('listitem', { name: 'Standard' })

    expect(within(std).getByRole('button', { name: 'Search for Upgrade' })).toBeEnabled()
    await userEvent.click(within(std).getByRole('button', { name: 'Standard Actions' }))
    expect(names(screen.getByRole('menu', { name: 'Standard Actions' }))).toEqual(['Manual Search…', 'File Details…', 'Switch Profile…HD', 'Show in Log', 'Delete Files…', 'Remove Version…'])
  })
}

describe('row actions on the Title page', suite.bind(null, false))

describe('row actions on the Title page, on a phone', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} })))
  suite(true)
})

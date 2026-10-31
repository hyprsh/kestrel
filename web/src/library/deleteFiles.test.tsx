import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Deleted = { version: number; query: string }

/**
 * Answers DELETE /versions/{id}/files and records each call's query; `adopted`
 * files cannot be blocklisted, and an `undeletable` file stays on disk.
 */
function recordDeletes({ adopted = false, undeletable = false } = {}) {
  const sent: Deleted[] = []
  server.use(
    http.delete('/versions/{id}/files', ({ params, request, response }) => {
      const query = new URL(request.url).searchParams
      sent.push({ version: Number(params.id), query: query.toString() })
      const blocklisted = query.get('blocklist') === 'true' && !adopted
      if (undeletable) return response(200).json({ files: [], not_deleted: [{ path: '/m/Paddington.mkv', episode_ids: [], reason: 'permission denied' }] })
      return response(200).json({ files: [{ path: '/m/Paddington.mkv', size: 1 << 30, release_name: 'Paddington.2014', episode_ids: [], blocklisted }], not_deleted: [] })
    }),
  )
  return sent
}

const movieFile: components['schemas']['FileSummary'] = {
  path: '/data/media/movies/Paddington (2014)/Paddington (2014) - [Standard].mkv',
  size: 4 * 2 ** 30,
  release_name: 'Paddington.2014.1080p.BluRay.x264-GRP',
  score: 120,
  imported_at: '2026-10-17T12:00:00Z',
}

/** Paddington with a filled Standard Version (id 11). */
async function openFilledMovie() {
  const r = row(1, 'Paddington', 'Paddington', { slots: { standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false }, '4k': null } })
  fakeLibrary([r])
  server.use(
    http.get('/titles/{id}', ({ response }) =>
      response(200).json(
        detail(r, { versions: [{ id: 11, slot: 'standard', profile: 'hd-primary', state: 'filled', long_missing: false, wanted_since: null, file: movieFile, added_at: r.added_at }] }),
      ),
    ),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name: /paddington/i })
  return within(pane).findByRole('listitem', { name: 'Standard' })
}

describe("deleting a Movie's file", () => {
  it('names the file and its size, and deletes it without blocklisting', async () => {
    const sent = recordDeletes()
    const hd = await openFilledMovie()

    await userEvent.click(within(hd).getByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    const confirm = within(hd).getByRole('dialog', { name: 'Delete files' })
    expect(confirm).toHaveTextContent('Paddington (2014) - [Standard].mkv')
    expect(confirm).toHaveTextContent('4.0 GB')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    expect(within(hd).queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument()
    await waitFor(() => expect(sent).toEqual([{ version: 11, query: '' }]))
    expect(await findToast('Deleted 1 file.')).toBeInTheDocument()
  })

  it('can blocklist the Release too, and says when it could not', async () => {
    const sent = recordDeletes({ adopted: true })
    const hd = await openFilledMovie()

    await userEvent.click(within(hd).getByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    await userEvent.click(within(hd).getByRole('button', { name: 'Delete and blocklist this Release' }))

    await waitFor(() => expect(sent).toEqual([{ version: 11, query: 'blocklist=true' }]))
    expect(await findToast(/not blocklisted/)).toBeInTheDocument()
  })

  it('says when the file could not be deleted, and why', async () => {
    recordDeletes({ undeletable: true })
    const hd = await openFilledMovie()

    await userEvent.click(within(hd).getByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    await userEvent.click(within(hd).getByRole('button', { name: 'Delete' }))

    const toast = await findToast(/Could not delete Paddington.mkv: permission denied./)
    expect(toast).not.toHaveTextContent('Nothing to delete')
  })

  it('says in a Toast when the request failed, after the dialog closed', async () => {
    server.use(
      http.delete('/versions/{id}/files', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'disk offline' }, { status: 500 })),
    )
    const hd = await openFilledMovie()

    await userEvent.click(within(hd).getByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    await userEvent.click(within(hd).getByRole('button', { name: 'Delete' }))

    expect(await findToast('Could not delete the files: disk offline')).toBeInTheDocument()
    expect(within(hd).queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument()
  })

  it('cancels without deleting', async () => {
    const sent = recordDeletes()
    const hd = await openFilledMovie()

    await userEvent.click(within(hd).getByRole('button', { name: 'More Standard Version actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }))
    await userEvent.click(within(hd).getByRole('button', { name: 'Cancel' }))

    expect(within(hd).queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument()
    expect(sent).toEqual([])
  })
})

const double: components['schemas']['EpisodeFile'] = {
  id: 70,
  path: '/data/media/tv/Breaking Bad/Season 01/Breaking Bad - S01E01-E02 - [Standard].mkv',
  size: 3 * 2 ** 30,
  quality: 'WEBDL-1080p',
  episode_ids: [2, 3],
}

/** Breaking Bad (Standard 51, 4K 52) whose Standard pilot and S01E02 share one double-episode file. */
async function openSeriesWithFiles() {
  const state = fakeSeries()
  state.get().episodes = [
    episode(1, 0, 1, 'Good Cop Bad Cop'),
    episode(2, 1, 1, 'Pilot', { cells: { standard: cell('filled', 120, double), '4k': cell('wanted') } }),
    episode(3, 1, 2, "Cat's in the Bag...", { cells: { standard: cell('filled', 120, double), '4k': cell('wanted') } }),
  ]
  const sent = recordDeletes()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const grid = await screen.findByRole('grid', { name: 'Episodes' })
  return { grid, sent }
}

/** Picks `item` from the menu `menu`, a row's in the table or one outside it (a season's above the table, the ticked episodes' in their bar). */
async function choose(grid: HTMLElement | null, menu: string, item: string) {
  await userEvent.click((grid ? within(grid) : screen).getByRole('button', { name: menu }))
  await userEvent.click(screen.getByRole('menuitem', { name: item }))
}

describe('deleting files from the episode table', () => {
  afterEach(() => localStorage.clear()) // opened seasons are remembered per Title

  it("deletes an episode's file, naming every episode the shared file holds", async () => {
    const { grid, sent } = await openSeriesWithFiles()

    await choose(grid, 'Actions for Season 1 episode 1', 'Delete file Standard')
    const confirm = screen.getByRole('dialog', { name: 'Delete files' })
    expect(confirm).toHaveTextContent('Breaking Bad - S01E01-E02 - [Standard].mkv')
    expect(confirm).toHaveTextContent('3.0 GB')
    expect(confirm).toHaveTextContent('Loses its file: S01E01, S01E02')
    expect(confirm).toHaveTextContent('S01E02 shares a file with it and loses its file too')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(sent).toEqual([{ version: 51, query: 'season=1&episode_ids=2' }]))
    expect(await screen.findByText(/Deleted 1 file of S01E01/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument()
  })

  it("asks right under the episode's row, with focus on the question, and Escape takes it back to the row", async () => {
    const { grid, sent } = await openSeriesWithFiles()
    const pilot = within(grid).getByRole('checkbox', { name: 'Tick Season 1 episode 1' })

    await choose(grid, 'Actions for Season 1 episode 1', 'Delete file Standard')

    const confirm = within(grid).getByRole('dialog', { name: 'Delete files' })
    expect(confirm.closest('tr')?.previousElementSibling).toContainElement(pilot)
    expect(confirm).toHaveFocus()

    await userEvent.keyboard('{Escape}')

    expect(within(grid).queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 1' }).closest('tr')).toContainElement(document.activeElement as HTMLElement)
    expect(sent).toEqual([])
  })

  it("asks under the season's buttons, above the table, for a season's files", async () => {
    const { grid } = await openSeriesWithFiles()

    await choose(null, 'Actions for Season 1', "Delete season's files Standard")

    const confirm = screen.getByRole('dialog', { name: 'Delete files' })
    expect(grid.contains(confirm)).toBe(false)
    expect(confirm.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(confirm).toHaveFocus()
  })

  it('cannot delete a file a Slot does not have', async () => {
    const { grid } = await openSeriesWithFiles()
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 1' }))
    expect(screen.getByRole('menuitem', { name: 'Delete file 4K' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers Delete file wherever the Slot dot is filled, in a Series kept in 4K only', async () => {
    const state = fakeSeries()
    const file = (id: number, n: number): components['schemas']['EpisodeFile'] => ({
      id,
      path: `/data/media/tv/Breaking Bad/Season 01/Breaking Bad - S01E0${n} - [4K].mkv`,
      size: 2 ** 30,
      quality: 'WEBDL-2160p',
      episode_ids: [n + 1],
    })
    state.get().episodes = [
      episode(2, 1, 1, 'Pilot', { cells: { standard: null, '4k': cell('filled', 120, file(80, 1)) } }),
      episode(3, 1, 2, "Cat's in the Bag...", { cells: { standard: null, '4k': cell('wanted') } }),
    ]
    const r = seriesRow(5, 'Breaking Bad')
    server.use(
      http.get('/titles/{id}', ({ response }) =>
        response(200).json(
          detail(r, {
            kind: 'series',
            series_monitor: 'all',
            versions: [{ id: 52, slot: '4k', profile: '4k-primary', state: 'wanted', long_missing: false, wanted_since: null, file: null, added_at: r.added_at }],
          }),
        ),
      ),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const grid = await screen.findByRole('grid', { name: 'Episodes' })

    expect(within(grid).getByRole('button', { name: 'Season 1 episode 1 4K: Filled' })).toBeInTheDocument()
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 1' }))
    expect(screen.getByRole('menuitem', { name: 'Delete file' })).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')

    expect(within(grid).getByRole('button', { name: 'Season 1 episode 2 4K: Wanted' })).toBeInTheDocument()
    await userEvent.click(within(grid).getByRole('button', { name: 'Actions for Season 1 episode 2' }))
    expect(screen.getByRole('menuitem', { name: 'Delete file' })).toHaveAttribute('aria-disabled', 'true')
  })

  it("deletes a season's files from the season's menu, blocklisting their Release", async () => {
    const { sent } = await openSeriesWithFiles()

    await choose(null, 'Actions for Season 1', "Delete season's files Standard")
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete files' })).getByRole('button', { name: 'Delete and blocklist this Release' }))

    await waitFor(() => expect(sent).toEqual([{ version: 51, query: 'season=1&blocklist=true' }]))
  })

  it('deletes the files of the ticked episodes', async () => {
    const { grid, sent } = await openSeriesWithFiles()

    await choose(grid, 'Actions for Season 1 episode 2', 'Tick')
    const bar = screen.getByRole('toolbar', { name: 'S01E02 ticked' })
    await choose(null, 'More actions for the ticked episodes', 'Delete files Standard')
    expect(screen.getByRole('dialog', { name: 'Delete files' })).toHaveTextContent('S01E01 shares a file with it')
    expect(within(grid).queryByRole('dialog', { name: 'Delete files' })).not.toBeInTheDocument() // in the bar for ticked episodes
    expect(bar).toContainElement(screen.getByRole('dialog', { name: 'Delete files' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete files' })).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(sent).toEqual([{ version: 51, query: 'episode_ids=3' }]))
  })
})

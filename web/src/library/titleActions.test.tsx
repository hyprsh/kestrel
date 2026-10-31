import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name })
  return { pane, actions: await within(pane).findByRole('group', { name: 'Title actions' }) }
}

describe('the Title actions row', () => {
  it('sits under the description, above the Version rows and the episode grid', async () => {
    fakeSeries()
    const { pane, actions } = await openTitle(/breaking bad/i)

    const overview = within(pane).getByText('About Breaking Bad.')
    const card = within(pane).getByRole('region', { name: 'Versions' })
    const grid = await within(pane).findByRole('grid', { name: 'Episodes' })
    expect(overview.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the metadata, Clean up, Move and Remove Title actions in its "…" menu, and asks before removing', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const removed: string[] = []
    server.use(
      http.delete('/titles/{id}', ({ request, response }) => {
        removed.push(request.url)
        return response(204).empty()
      }),
    )
    const { actions } = await openTitle(/paddington/i)

    await userEvent.click(within(actions).getByRole('button', { name: 'More Title actions' }))
    const menu = screen.getByRole('menu', { name: 'More Title actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Refresh metadata', 'Freeze metadata', 'Move', 'Clean up this Title', 'Show in the Log', 'Remove Title'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove Title' }))

    const confirm = screen.getByRole('alertdialog', { name: 'Remove Title' })
    expect(within(confirm).getByRole('checkbox', { name: 'Also delete files' })).not.toBeChecked()
    expect(removed).toEqual([])
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removed).toHaveLength(1))
    expect(removed[0]).toContain('delete_files=false')
  })

  it('closes the Remove Title dialog on confirm and says in a Toast why the removal failed', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    server.use(http.delete('/titles/{id}', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'disk offline' }, { status: 500 })))
    const { actions } = await openTitle(/paddington/i)

    await userEvent.click(within(actions).getByRole('button', { name: 'More Title actions' }))
    await userEvent.click(within(screen.getByRole('menu', { name: 'More Title actions' })).getByRole('menuitem', { name: 'Remove Title' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Remove Title' })).getByRole('button', { name: 'Remove' }))

    expect(await findToast('Could not remove the Title: disk offline')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('refreshes the metadata, and freezes it so it is not refreshed', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    const state = { frozen: false, refreshes: 0, sent: [] as unknown[] }
    server.use(
      http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { metadata_frozen: state.frozen }))),
      http.post('/titles/{id}/refresh', ({ response }) => {
        state.refreshes++
        return response(202).empty()
      }),
      http.patch('/titles/{id}', async ({ request, response }) => {
        const body = await request.json()
        state.sent.push(body)
        if (body.metadata_frozen !== undefined) state.frozen = body.metadata_frozen
        return response(200).json(detail(r, { metadata_frozen: state.frozen }))
      }),
    )
    const { actions } = await openTitle(/paddington/i)

    const choose = async (name: string) => {
      await userEvent.click(within(actions).getByRole('button', { name: 'More Title actions' }))
      return userEvent.click(screen.getByRole('menuitem', { name }))
    }

    await choose('Refresh metadata')
    await waitFor(() => expect(state.refreshes).toBe(1))
    expect(await screen.findByText(/Refreshing metadata…/)).toBeInTheDocument()

    await choose('Freeze metadata')
    await waitFor(() => expect(state.sent).toEqual([{ metadata_frozen: true }]))
    await userEvent.click(within(actions).getByRole('button', { name: 'More Title actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Unfreeze metadata' })).toBeInTheDocument()
    const refresh = screen.getByRole('menuitem', { name: /Refresh metadata/ })
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    expect(refresh).toHaveAccessibleDescription('Metadata is frozen: unfreeze it to refresh')
    await userEvent.keyboard('{Escape}')

    await choose('Unfreeze metadata')
    await waitFor(() => expect(state.sent[1]).toEqual({ metadata_frozen: false }))
    await userEvent.click(within(actions).getByRole('button', { name: 'More Title actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Refresh metadata' })).not.toHaveAttribute('aria-disabled', 'true'))
  })
})

describe('the Version rows', () => {
  const standardOnly = (r: ReturnType<typeof seriesRow>, coverage: NonNullable<ReturnType<typeof detail>['versions'][number]['coverage']>) =>
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.filter((v) => v.slot === 'standard').map((v) => ({ ...v, coverage })) })
      }),
    )

  it('show a Series Version’s bar and its counts as plain text, with the Wanted and Long Missing counts and the size', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 236, filled: 228, wanted: 8, long_missing: 2, unmonitored: 4, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 })
    const { pane } = await openTitle(/breaking bad/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('img', { name: 'Standard: 228 of 240 episodes, 4 not monitored' })).toBeInTheDocument()
    expect(within(hd).getByText('228 of 240 · 8 Wanted · 2 Long Missing · 4 not monitored · 412.0 GB')).toBeInTheDocument()
    expect(within(hd).queryByRole('button', { name: /episodes/ })).not.toBeInTheDocument()
    expect(within(hd).queryByRole('link')).not.toBeInTheDocument()
    expect(within(pane).queryByRole('list', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('show a Series Slot without a Version as the same row, with an empty bar, "Not kept" and Add Version', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 21, filled: 21, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const { pane } = await openTitle(/breaking bad/i)

    const uhd = within(pane).getByRole('listitem', { name: '4K' })
    expect(uhd).toHaveTextContent('4KNot kept')
    expect(within(uhd).queryByRole('img', { name: /episodes/ })).not.toBeInTheDocument()
    expect(await within(uhd).findByRole('button', { name: 'Add Version: 4K' })).toBeInTheDocument()
  })

  it('show a Movie Version’s state as a bar and plain text: not out yet, or Wanted for days', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'unreleased' })) })
      }),
    )
    const { pane } = await openTitle(/paddington/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(await within(hd).findByText('Not out yet')).toBeInTheDocument()
    expect(within(hd).getByRole('progressbar', { name: 'Standard: Unreleased' })).toBeInTheDocument()
  })

  it('show a Movie Version’s file as a full bar with its quality and size, the path behind a click', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    const file = {
      path: '/data/media/movies/Paddington (2014)/Paddington.mkv',
      size: 8 * 1024 ** 3,
      release_name: 'Paddington.2014.1080p.BluRay',
      score: null,
      quality: 'Bluray-1080p',
      languages: [],
      imported_at: '2026-10-17T12:00:00Z',
    }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
      }),
    )
    const { pane } = await openTitle(/paddington/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('img', { name: 'Standard: filled' })).toBeInTheDocument()
    expect(await within(hd).findByRole('button', { name: 'Bluray-1080p · 8.0 GB' })).toBeInTheDocument()
    expect(within(hd).queryByRole('link')).not.toBeInTheDocument()
  })

  it('keep Change Profile, Delete file and Remove Version in a Movie row’s "…" menu, Delete file disabled without a file', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const { pane } = await openTitle(/paddington/i)

    await userEvent.click(within(within(pane).getByRole('listitem', { name: 'Standard' })).getByRole('button', { name: 'More Standard Version actions' }))
    const menu = screen.getByRole('menu', { name: 'More Standard Version actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Change Profile', 'Delete fileNo file to delete', 'Remove Version'])
    expect(within(menu).getByRole('menuitem', { name: /Delete file/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keep a Series Version’s menu to Change Profile and Remove Version', async () => {
    fakeSeries()
    const { pane } = await openTitle(/breaking bad/i)

    await userEvent.click(within(within(pane).getByRole('listitem', { name: 'Standard' })).getByRole('button', { name: 'More Standard Version actions' }))
    const menu = screen.getByRole('menu', { name: 'More Standard Version actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Change Profile', 'Remove Version'])
  })
})

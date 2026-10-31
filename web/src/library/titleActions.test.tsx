import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished } from 'vitest'
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
  it('show a Series Version’s episode coverage instead of a file, and scroll to the episodes on a click', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    const coverage = { episodes: 236, filled: 230, wanted: 6, long_missing: 2, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, coverage })) })
      }),
    )
    const scrolled: Element[] = []
    // jsdom does not scroll: record what is scrolled to instead.
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    onTestFinished(() => {
      Element.prototype.scrollIntoView = before
    })
    const { pane } = await openTitle(/breaking bad/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(within(hd).queryByText('No file yet')).not.toBeInTheDocument()
    const summary = within(hd).getByRole('button', { name: '230 of 236 episodes · 412.0 GB · 6 Wanted · 2 Long Missing' })
    await userEvent.click(summary)
    const grid = await within(pane).findByRole('grid', { name: 'Episodes' })
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0].contains(grid)).toBe(true)
  })

  it('show an empty Slot as one quiet row with Add Version, and a filled one with its state', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const { pane } = await openTitle(/paddington/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByText('Wanted')).toBeInTheDocument()
    expect(await within(hd).findByText('HD')).toBeInTheDocument() // the Profile's name arrives with GET /profiles
    expect(within(hd).getByText('No file yet')).toBeInTheDocument()
    const uhd = within(pane).getByRole('listitem', { name: '4K' })
    expect(uhd).toHaveTextContent('4KNot kept')
    expect(within(uhd).queryByRole('button', { name: /More 4K Version actions/ })).not.toBeInTheDocument()
    expect(await within(uhd).findByRole('button', { name: 'Add Version: 4K' })).toBeInTheDocument()
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

describe('the status line in the header', () => {
  it('badges each Slot of a Movie with its state, or as not kept', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const { pane } = await openTitle(/paddington/i)

    const status = within(pane).getByRole('list', { name: 'Status' })
    expect(
      within(status)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Standard · Wanted', '4K · Not kept'])
  })

  it('gives each Series Slot a row of its label, a bar and its counts, with the Wanted and Long Missing counts', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    const coverage = { episodes: 236, filled: 228, wanted: 8, long_missing: 2, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.filter((v) => v.slot === 'standard').map((v) => ({ ...v, coverage })) })
      }),
    )
    const { pane } = await openTitle(/breaking bad/i)

    const status = within(pane).getByRole('list', { name: 'Status' })
    const bar = within(status).getByRole('progressbar', { name: 'Standard: 228 of 236 episodes' })
    expect(bar).toHaveAttribute('aria-valuenow', '228')
    expect(bar).toHaveAttribute('aria-valuemax', '236')
    expect(status).toHaveTextContent('228 of 236 · 8 Wanted · 2 Long Missing')
  })

  it('shows a Series Slot without a Version as the same row, with an empty track and "Not kept" and no badge', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    const coverage = { episodes: 21, filled: 21, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.filter((v) => v.slot === 'standard').map((v) => ({ ...v, coverage })) })
      }),
    )
    const { pane } = await openTitle(/breaking bad/i)

    const status = within(pane).getByRole('list', { name: 'Status' })
    const rows = within(status).getAllByRole('listitem')
    expect(rows.map((i) => i.textContent)).toEqual(['Standard21 of 21', '4KNot kept'])
    expect(within(rows[1]).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('counts the released episodes that are not monitored in the counts and the bar’s name', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    const coverage = { episodes: 21, filled: 21, wanted: 0, long_missing: 0, unmonitored: 19, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.filter((v) => v.slot === 'standard').map((v) => ({ ...v, coverage })) })
      }),
    )
    const { pane } = await openTitle(/breaking bad/i)

    const status = within(pane).getByRole('list', { name: 'Status' })
    const bar = within(status).getByRole('progressbar', { name: 'Standard: 21 of 40 episodes, 19 not monitored' })
    expect(bar).toHaveAttribute('aria-valuemax', '40')
    expect(status).toHaveTextContent('21 of 40 · 19 not monitored')
  })
})

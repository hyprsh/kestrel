import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name })
  return { pane, actions: await within(pane).findByRole('group', { name: 'Title actions' }) }
}

describe('the Title actions row', () => {
  it('sits under the description, above the Slot cards and the episode grid', async () => {
    fakeSeries()
    const { pane, actions } = await openTitle(/breaking bad/i)

    const overview = within(pane).getByText('About Breaking Bad.')
    const card = within(pane).getByRole('group', { name: 'Standard' })
    const grid = await within(pane).findByRole('grid', { name: 'Episodes' })
    expect(overview.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps Clean up, Move and Remove Title in its "…" menu, and asks before removing', async () => {
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
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Move', 'Clean up this Title', 'Show in the Log', 'Remove Title'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove Title' }))

    const confirm = screen.getByRole('alertdialog', { name: 'Remove Title' })
    expect(within(confirm).getByRole('checkbox', { name: 'Also delete files' })).not.toBeChecked()
    expect(removed).toEqual([])
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removed).toHaveLength(1))
    expect(removed[0]).toContain('delete_files=false')
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

    await userEvent.click(within(actions).getByRole('button', { name: 'Refresh metadata' }))
    await waitFor(() => expect(state.refreshes).toBe(1))
    expect(await screen.findByText(/Refreshing metadata…/)).toBeInTheDocument()

    await userEvent.click(within(actions).getByRole('button', { name: 'Freeze metadata' }))
    await waitFor(() => expect(state.sent).toEqual([{ metadata_frozen: true }]))
    expect(await within(actions).findByRole('button', { name: 'Unfreeze metadata' })).toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: 'Refresh metadata' })).toBeDisabled()

    await userEvent.click(within(actions).getByRole('button', { name: 'Unfreeze metadata' }))
    await waitFor(() => expect(state.sent[1]).toEqual({ metadata_frozen: false }))
    await waitFor(() => expect(within(actions).getByRole('button', { name: 'Refresh metadata' })).toBeEnabled())
  })
})

describe('the Slot cards', () => {
  it('show a Series Version’s episode coverage instead of a file, and scroll to the episodes on a click', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    const coverage = { episodes: 236, filled: 230, wanted: 6, long_missing: 2, size: 412 * 1024 ** 3 }
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

    const hd = within(pane).getByRole('group', { name: 'Standard' })
    expect(within(hd).queryByText('No file yet')).not.toBeInTheDocument()
    const summary = within(hd).getByRole('button', { name: '230 of 236 episodes · 412.0 GB · 6 Wanted · 2 Long Missing' })
    await userEvent.click(summary)
    const grid = await within(pane).findByRole('grid', { name: 'Episodes' })
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0].contains(grid)).toBe(true)
  })

  it('badge an empty Slot as having no Version, as a filled one shows its state', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const { pane } = await openTitle(/paddington/i)

    expect(within(within(pane).getByRole('group', { name: 'Standard' })).getByText('Wanted')).toBeInTheDocument()
    const uhd = within(pane).getByRole('group', { name: '4K' })
    expect(within(uhd).getByText('No Version')).toBeInTheDocument()
    expect(await within(uhd).findByRole('button', { name: 'Add Version' })).toBeInTheDocument()
  })
})

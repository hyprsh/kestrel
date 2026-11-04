import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row } from '../test/library'
import { fakeQueue, queueItem } from '../test/queue'
import { cell, episode, fakeSeries, seriesRow } from '../test/series'
import { server } from '../test/server'
import { chooseTitleItem, openTitleMenu, openTitleSubmenu } from '../test/titleHeader'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openTitle(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name })
  await within(pane).findByRole('button', { name: 'Title actions' })
  return pane
}

describe('the Title page header', () => {
  it('holds the search button and the Title menu beside the name, above the Versions and the seasons', async () => {
    fakeSeries()
    const pane = await openTitle(/breaking bad/i)

    const heading = within(pane).getByRole('heading', { name: 'Breaking Bad' })
    const menu = within(pane).getByRole('button', { name: 'Title actions' })
    const versions = within(pane).getByRole('region', { name: 'Versions' })
    expect(heading.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(menu.compareDocumentPosition(versions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(pane).getByRole('button', { name: 'Search Wanted' })).toBeInTheDocument()
    expect(within(pane).queryByRole('group', { name: 'Title actions' })).not.toBeInTheDocument()
  })

  it('shows what is Wanted, downloading and next as badges, and the year and seasons on one line, and monitoring in its own button', async () => {
    const fake = fakeSeries()
    fake.episodes.push(
      episode(4, 1, 3, 'Down', { cells: { standard: cell('downloading'), '4k': cell('unreleased') } }),
      episode(5, 1, 4, 'Soon', { air_date: '2999-01-02', cells: { standard: cell('unreleased'), '4k': cell('unreleased') } }),
    )
    fakeQueue([queueItem({ title_id: 5, slot: 'standard', episodes: ['S01E03'] })])
    const pane = await openTitle(/breaking bad/i)

    expect((await within(pane).findAllByText('1 Wanted')).length).toBeGreaterThan(0)
    expect(within(pane).getByText('1 downloading · 75%')).toBeInTheDocument()
    expect(within(pane).getByText(/^Next: S01E04 · /)).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: /^Monitoring: monitored, all episodes/ })).toHaveTextContent('Monitored · all episodes')
    expect(within(pane).getAllByText(/^1 season/).length).toBeGreaterThan(0) // the meta line and the table's head
    expect(within(pane).getByText(/^Ended/)).toBeInTheDocument()
  })

  it('keeps every Title action in the Title menu and asks before removing', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const removed: string[] = []
    server.use(
      http.delete('/titles/{id}', ({ request, response }) => {
        removed.push(request.url)
        return response(204).empty()
      }),
    )
    const pane = await openTitle(/paddington/i)

    const menu = await openTitleMenu(pane)
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(names).toEqual(['Add Version…', 'Metadata', 'Open in', 'Show in Log', 'Files', 'Remove Title…'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove Title…' }))

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
    const pane = await openTitle(/paddington/i)

    await chooseTitleItem(pane, 'Remove Title…')
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
    const pane = await openTitle(/paddington/i)

    await chooseTitleItem(pane, 'Refresh Metadata', 'Metadata')
    await waitFor(() => expect(state.refreshes).toBe(1))
    expect(await findToast('Refreshing metadata… The Title updates when it is done.')).toBeInTheDocument()

    await chooseTitleItem(pane, 'Freeze Metadata', 'Metadata')
    await waitFor(() => expect(state.sent).toEqual([{ metadata_frozen: true }]))
    const menu = await openTitleSubmenu(pane, 'Metadata')
    expect(await within(menu).findByRole('menuitem', { name: 'Unfreeze Metadata' })).toBeInTheDocument()
    const refresh = within(menu).getByRole('menuitem', { name: /Refresh Metadata/ })
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    expect(refresh).toHaveAccessibleDescription('Metadata is frozen: unfreeze it to refresh')
    await userEvent.keyboard('{Escape}{Escape}') // the submenu, then the menu

    await chooseTitleItem(pane, 'Unfreeze Metadata', 'Metadata')
    await waitFor(() => expect(state.sent[1]).toEqual({ metadata_frozen: false }))
    const again = await openTitleSubmenu(pane, 'Metadata')
    await waitFor(() => expect(within(again).getByRole('menuitem', { name: 'Refresh Metadata' })).not.toHaveAttribute('aria-disabled', 'true'))
  })
})

describe('the Version cards', () => {
  const standardOnly = (r: ReturnType<typeof seriesRow>, coverage: NonNullable<ReturnType<typeof detail>['versions'][number]['coverage']>) =>
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r, { kind: 'series', tvdb_id: 81189, series_monitor: 'all' })
        return response(200).json({ ...d, versions: d.versions.filter((v) => v.slot === 'standard').map((v) => ({ ...v, coverage })) })
      }),
    )

  it('show a Series Version as a card: its state, a bar with its count and its actions', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 236, filled: 228, wanted: 8, long_missing: 2, unmonitored: 4, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('img', { name: /^Standard: 228 of 240 episodes/ })).toHaveTextContent(/228\/240/)
    // Long Missing is its own red segment after Wanted, and counts once: 8 Wanted less 2 Long Missing leaves 6 Wanted.
    expect(Array.from(hd.querySelectorAll('[data-bar]')).map((q) => q.getAttribute('data-bar'))).toEqual(['filled', 'wanted', 'long_missing', 'unmonitored'])
    expect(hd.querySelector('[data-bar="wanted"]')).toHaveStyle({ flex: '6 0 0' })
    expect(hd.querySelector('[data-bar="long_missing"]')).toHaveStyle({ flex: '2 0 0' })
    expect(within(hd).getByText(/^8 Wanted · 2 Long Missing · 4 not monitored/)).toBeInTheDocument()
    expect(within(hd).getByRole('button', { name: 'Search Now' })).toBeEnabled()
  })

  it('say a complete Series Version by its count, with a thin bar and no state text', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 62, filled: 62, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('img', { name: /^Standard: 62 of 62 episodes/ })).toHaveTextContent(/62\/62/)
    expect(hd.querySelector('[data-complete]')).not.toBeNull()
    expect(within(hd).queryByText('Complete')).not.toBeInTheDocument()
    expect(within(hd).getByRole('button', { name: 'Search for Upgrade' })).toBeInTheDocument()
  })

  it('leave a Wanted Special out of a Series Version’s episode total but count it as Wanted', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    // Both regular episodes are filled; the one Wanted episode is a monitored Special, so it is not in `episodes`.
    standardOnly(r, { episodes: 2, filled: 2, wanted: 1, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByText('1 Wanted')).toBeInTheDocument()
    expect(within(hd).getByRole('img', { name: /^Standard: 2 of 2 episodes/ })).toHaveTextContent(/2\/2/)
  })

  it('keep both Versions’ heads on a Series with two Slots, and ring the one ?slot= names', async () => {
    fakeSeries()
    history.replaceState(null, '', '/library?slot=4k')
    const pane = await openTitle(/breaking bad/i)

    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).getByRole('listitem', { name: '4K' })).toHaveAttribute('data-current')
    expect(within(pane).getByRole('listitem', { name: 'Standard' })).not.toHaveAttribute('data-current')
    expect(within(pane).queryByRole('button', { name: 'Add Version' })).not.toBeInTheDocument() // both Slots have a Version
  })

  it('leave out a Slot without a Version: Add Version… is in the Title menu', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 21, filled: 21, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).queryByRole('listitem', { name: '4K' })).not.toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Add Version' })).toBeInTheDocument() // the column after the last Version
  })

  it('show a Movie Version’s state in words: not out yet', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'unreleased' })) })
      }),
    )
    const pane = await openTitle(/paddington/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(await within(hd).findByText('Not out yet')).toBeInTheDocument()
  })

  it('show a Movie Version’s file as quality, codec, audio, languages and size, with when it was imported and the path behind File details', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    const file = {
      path: '/data/media/movies/Paddington (2014)/Paddington.mkv',
      size: 8 * 1024 ** 3,
      release_name: 'Paddington.2014.1080p.BluRay',
      score: 2290,
      quality: 'Bluray-1080p',
      video_codec: 'H.264',
      audio_codec: 'DTS',
      audio_channels: '5.1',
      languages: ['English', 'German'],
      release_group: 'GRP',
      custom_formats: [
        { name: 'Remux Tier 01', points: 2300 },
        { name: 'x265', points: -10 },
      ],
      imported_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'filled', file })) })
      }),
    )
    const pane = await openTitle(/paddington/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    await userEvent.click(within(hd).getByRole('button', { name: 'Standard Actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'File Details…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Standard File Details' }))
    // A fact is the label with its value after it.
    const fact = (k: string) => dialog.getByText(k).nextElementSibling
    expect(fact('Quality')).toHaveTextContent('BluRay 1080p')
    expect(fact('Video')).toHaveTextContent('H.264 · SDR')
    expect(fact('Audio')).toHaveTextContent('DTS 5.1 · English, German')
    expect(fact('Size')).toHaveTextContent('8 GB')
    expect(fact('Group')).toHaveTextContent('GRP')
    expect(fact('Imported')).toBeInTheDocument()
    expect(fact('Path')).toHaveTextContent('/data/media/movies/Paddington (2014)/Paddington.mkv')
    // The Score and each Custom Format the file matched, with its points.
    expect(fact('Score')).toHaveTextContent('2,290')
    expect(fact('Remux Tier 01')).toHaveTextContent('+2,300')
    expect(fact('x265')).toHaveTextContent('\u221210')
  })

  it('show a Wanted Movie Version for how many days, with Search Now as its one action', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openTitle(/paddington/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('button', { name: 'Search Now' })).toBeEnabled()
    expect(hd).toHaveTextContent('Wanted 12 days')
    expect(hd).toHaveTextContent('Not searched yet')
  })

  it('keep Manual search, Switch Profile, Show in Log, Delete files and Remove Version in a Movie row’s "⋯" menu, Delete files disabled without a file', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const pane = await openTitle(/paddington/i)

    await userEvent.click(await within(pane).findByRole('button', { name: 'Standard Actions' }))
    const menu = screen.getByRole('menu', { name: 'Standard Actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Manual Search…', 'File Details…No file yet', 'Switch Profile…HD', 'Show in Log', 'Delete Files…No file to delete', 'Remove Version…'])
    expect(within(menu).getByRole('menuitem', { name: /Delete Files/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keep a Series Version’s menu to Manual search, Switch Profile, Show in Log and Remove Version', async () => {
    fakeSeries()
    const pane = await openTitle(/breaking bad/i)

    await userEvent.click(await within(pane).findByRole('button', { name: 'Standard Actions' })) // on the column head
    const menu = screen.getByRole('menu', { name: 'Standard Actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Manual Search…', 'Switch Profile…HD', 'Show in Log', 'Remove Version…'])
  })
})

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
    expect(within(pane).queryByRole('button', { name: 'Search now' })).not.toBeInTheDocument()
  })

  it('shows what is Wanted, downloading and next as badges, and the year and seasons on one line, and monitoring in its own button', async () => {
    const fake = fakeSeries()
    fake.episodes.push(
      episode(4, 1, 3, 'Down', { cells: { standard: cell('downloading'), '4k': cell('unreleased') } }),
      episode(5, 1, 4, 'Soon', { air_date: '2999-01-02', cells: { standard: cell('unreleased'), '4k': cell('unreleased') } }),
    )
    fakeQueue([queueItem({ title_id: 5, slot: 'standard', episodes: ['S01E03'] })])
    const pane = await openTitle(/breaking bad/i)

    expect(await within(pane).findByText('1 Wanted')).toBeInTheDocument()
    expect(within(pane).getByText('1 downloading · 75%')).toBeInTheDocument()
    expect(within(pane).getByText(/^Next: S01E04 · /)).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: /^Monitoring: monitored, all episodes/ })).toHaveTextContent('Monitored · all episodes')
    expect(within(pane).getByText(/^1 season/)).toBeInTheDocument()
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

    await chooseTitleItem(pane, 'Refresh metadata', 'Metadata')
    await waitFor(() => expect(state.refreshes).toBe(1))
    expect(await findToast('Refreshing metadata… The Title updates when it is done.')).toBeInTheDocument()

    await chooseTitleItem(pane, 'Freeze metadata', 'Metadata')
    await waitFor(() => expect(state.sent).toEqual([{ metadata_frozen: true }]))
    const menu = await openTitleSubmenu(pane, 'Metadata')
    expect(await within(menu).findByRole('menuitem', { name: 'Unfreeze metadata' })).toBeInTheDocument()
    const refresh = within(menu).getByRole('menuitem', { name: /Refresh metadata/ })
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    expect(refresh).toHaveAccessibleDescription('Metadata is frozen: unfreeze it to refresh')
    await userEvent.keyboard('{Escape}{Escape}') // the submenu, then the menu

    await chooseTitleItem(pane, 'Unfreeze metadata', 'Metadata')
    await waitFor(() => expect(state.sent[1]).toEqual({ metadata_frozen: false }))
    const again = await openTitleSubmenu(pane, 'Metadata')
    await waitFor(() => expect(within(again).getByRole('menuitem', { name: 'Refresh metadata' })).not.toHaveAttribute('aria-disabled', 'true'))
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

  it('show a Series Version as a row: its episodes, a chip, a bar and its size', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 236, filled: 228, wanted: 8, long_missing: 2, unmonitored: 4, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    const row = within(hd).getByRole('button', { name: /^Standard: 228 of 240 episodes/ })
    expect(within(hd).getByRole('img', { name: /^Standard: 228 of 240 episodes/ })).toHaveTextContent(/228\/240/)
    expect(hd.querySelector('[data-bar="filled"]')).not.toBeNull()
    // Long Missing is its own red segment after Wanted, and counts once: 8 Wanted less 2 Long Missing leaves 6 Wanted.
    expect(Array.from(hd.querySelectorAll('[data-bar]')).map((q) => q.getAttribute('data-bar'))).toEqual(['filled', 'wanted', 'long_missing', 'unmonitored'])
    expect(hd.querySelector('[data-bar="wanted"]')).toHaveStyle({ flex: '6 0 0' })
    expect(hd.querySelector('[data-bar="long_missing"]')).toHaveStyle({ flex: '2 0 0' })
    // Opened (a lone Slot with something Wanted opens itself), each fact shows once: the facts say the coverage and size, the header does not.
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(within(hd).getByText('Coverage').nextSibling).toHaveTextContent('228 of 240 episodes · 8 Wanted · 2 Long Missing · 4 not monitored')
    // The row is one line open or closed: the state text, the count and the size stay in the header, the facts add Profile, Coverage and Size on disk.
    expect(within(hd).getByText('8 Wanted · 2 Long Missing · 4 not monitored')).toBeInTheDocument()
    expect(within(hd).getAllByText('412 GB')).toHaveLength(2)
    expect(within(hd).getByText('Profile')).toBeInTheDocument()
    // Closed, the header keeps saying them and the facts are folded away.
    await userEvent.click(row)
    expect(within(hd).getByText('8 Wanted · 2 Long Missing · 4 not monitored')).toBeInTheDocument()
    expect(within(hd).getAllByText('412 GB')).toHaveLength(1)
    expect(within(hd).queryByText('Coverage')).not.toBeInTheDocument()
  })

  it('say a complete Series Version as Complete, its count in its chip, with a thin bar', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 62, filled: 62, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    const row = within(hd).getByRole('button', { name: /^Standard: 62 of 62 episodes/ })
    expect(within(hd).getByRole('img', { name: /^Standard: 62 of 62 episodes/ })).toHaveTextContent(/62\/62/)
    expect(hd.querySelector('[data-complete]')).not.toBeNull()
    if (row.getAttribute('aria-expanded') === 'true') await userEvent.click(row)
    expect(within(hd).getByText('Complete')).toBeInTheDocument()
    expect(within(hd).getAllByText('1 GB')).toHaveLength(1)
    await userEvent.click(row)
    expect(within(hd).getByText('Complete')).toBeInTheDocument() // opened, the header still says it
    expect(within(hd).getByText('Coverage').nextSibling).toHaveTextContent('62 of 62 episodes')
    expect(within(hd).getAllByText('1 GB')).toHaveLength(2)
  })

  it('leave a Wanted Special out of a Series Version’s episode total but count it as Wanted', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    // Both regular episodes are filled; the one Wanted episode is a monitored Special, so it is not in `episodes`.
    standardOnly(r, { episodes: 2, filled: 2, wanted: 1, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByText('Coverage').nextSibling).toHaveTextContent('2 of 2 episodes · 1 Wanted')
    expect(within(hd).getByRole('img', { name: /^Standard: 2 of 2 episodes/ })).toHaveTextContent(/2\/2/)
  })

  it('keep a Series’ Slot rows closed when it has two Slots, and open and ring the one ?slot= names', async () => {
    fakeSeries()
    history.replaceState(null, '', '/library?slot=4k')
    const pane = await openTitle(/breaking bad/i)

    const std = within(await within(pane).findByRole('listitem', { name: 'Standard' })).getByRole('button', { name: /^Standard:/ })
    const uhd = within(within(pane).getByRole('listitem', { name: '4K' })).getByRole('button', { name: /^4K:/ })
    expect(std).toHaveAttribute('aria-expanded', 'false')
    expect(uhd).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('version-4k')).toHaveAttribute('data-current')
    expect(within(pane).queryByRole('button', { name: 'Add a Slot' })).not.toBeInTheDocument() // both Slots exist
  })

  it('leave out a Slot without a Version: Add Version… is in the Title menu', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 21, filled: 21, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(pane).queryByRole('listitem', { name: '4K' })).not.toBeInTheDocument()
    expect(within(pane).queryByText('Not kept')).not.toBeInTheDocument()
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

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    // The header's summary and the body's facts both say it.
    expect((await within(hd).findAllByText('Not out yet')).length).toBeGreaterThan(0)
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

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    // The row's chip also says "Imported"; a fact is the label with its value after it.
    const fact = async (k: string) => (await within(hd).findAllByText(k)).find((e) => e.nextElementSibling)!.nextElementSibling
    expect(await fact('Quality')).toHaveTextContent('BluRay 1080p')
    expect(await fact('Video')).toHaveTextContent('H.264')
    expect(await fact('Audio')).toHaveTextContent('DTS 5.1 · English, German')
    expect(await fact('Size')).toHaveTextContent('8 GB')
    expect(await fact('Imported')).toHaveTextContent(/from GRP$/)
    expect(await fact('Path')).toHaveTextContent('/data/media/movies/Paddington (2014)/Paddington.mkv')
    // The Score and each Custom Format the file matched, with its points.
    expect(await fact('Custom Format Score')).toHaveTextContent('+2,290')
    expect(within(hd).getByText('Remux Tier 01 +2300')).toBeInTheDocument()
    expect(within(hd).getByText('x265 \u221210')).toBeInTheDocument()
  })

  it('show a Wanted Movie Version for how many days, with Search now as its one action', async () => {
    const r = row(1, 'Paddington', 'Paddington')
    fakeLibrary([r])
    server.use(
      http.get('/titles/{id}', ({ response }) => {
        const d = detail(r)
        return response(200).json({ ...d, versions: d.versions.map((v) => ({ ...v, state: 'wanted', wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString() })) })
      }),
    )
    const pane = await openTitle(/paddington/i)

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect((await within(hd).findByText('Wanted since')).nextElementSibling).toHaveTextContent('12 days')
    expect(within(hd).getByRole('button', { name: 'Search Now' })).toBeEnabled()
    expect(hd).toHaveTextContent('No file yet')
  })

  it('keep Search now, Manual search, Change Profile, Delete files and Remove Version in a Movie row’s "…" menu, Delete files disabled without a file', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    const pane = await openTitle(/paddington/i)

    await userEvent.click(await within(pane).findByRole('button', { name: 'Standard Version actions' }))
    const menu = screen.getByRole('menu', { name: 'Standard Version actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Search now', 'Manual search…', 'Change Profile…HD', 'Delete files…No file to delete', 'Remove Version…'])
    expect(within(menu).getByRole('menuitem', { name: /Delete files/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keep a Series Version’s menu to Search now, Manual search, Change Profile and Remove Version', async () => {
    fakeSeries()
    const pane = await openTitle(/breaking bad/i)

    await userEvent.click(within(await within(pane).findByRole('listitem', { name: 'Standard' })).getByRole('button', { name: /^Standard:/ })) // the rows start closed
    await userEvent.click(await within(pane).findByRole('button', { name: 'Standard Version actions' }))
    const menu = screen.getByRole('menu', { name: 'Standard Version actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Search now', 'Manual search…', 'Change Profile…HD', 'Why is it Wanted?', 'Remove Version…'])
  })
})

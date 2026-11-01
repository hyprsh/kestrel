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
import { chooseTitleItem, openTitleMenu } from '../test/titleHeader'
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

  it('shows what is Wanted, downloading and next as badges, and the year, seasons and monitoring on one line', async () => {
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
    expect(within(pane).getByRole('button', { name: 'Monitoring all episodes' })).toBeInTheDocument()
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
    expect(names).toEqual([
      'Monitoring…Monitored',
      'Add Version…',
      'Refresh metadata',
      'Freeze metadata',
      'Open in TMDBTMDB 101',
      'Open in IMDbtt000001',
      'Show in Log',
      'Move…',
      'Clean up…',
      'Remove Title…',
    ])
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

    await chooseTitleItem(pane, 'Refresh metadata')
    await waitFor(() => expect(state.refreshes).toBe(1))
    expect(await findToast('Refreshing metadata… The Title updates when it is done.')).toBeInTheDocument()

    await chooseTitleItem(pane, 'Freeze metadata')
    await waitFor(() => expect(state.sent).toEqual([{ metadata_frozen: true }]))
    const menu = await openTitleMenu(pane)
    expect(await within(menu).findByRole('menuitem', { name: 'Unfreeze metadata' })).toBeInTheDocument()
    const refresh = within(menu).getByRole('menuitem', { name: /Refresh metadata/ })
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    expect(refresh).toHaveAccessibleDescription('Metadata is frozen: unfreeze it to refresh')
    await userEvent.keyboard('{Escape}')

    await chooseTitleItem(pane, 'Unfreeze metadata')
    await waitFor(() => expect(state.sent[1]).toEqual({ metadata_frozen: false }))
    const again = await openTitleMenu(pane)
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

  it('show a Series Version as a card: Wanted count, a bar, its episodes and size', async () => {
    const r = seriesRow(5, 'Breaking Bad')
    fakeSeries()
    standardOnly(r, { episodes: 236, filled: 228, wanted: 8, long_missing: 2, unmonitored: 4, downloading: 0, downloading_long_missing: 0, size: 412 * 1024 ** 3 })
    const pane = await openTitle(/breaking bad/i)

    const hd = await within(pane).findByRole('listitem', { name: 'Standard' })
    expect(within(hd).getByRole('progressbar', { name: 'Standard: 228 of 240 episodes, 4 not monitored' })).toBeInTheDocument()
    expect(within(hd).getByText('8 Wanted')).toBeInTheDocument()
    expect(within(hd).getByText('228 of 240 episodes · 2 Long Missing · 4 not monitored')).toBeInTheDocument()
    expect(within(hd).getByText('412.0 GB')).toBeInTheDocument()
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

    const hd = within(pane).getByRole('listitem', { name: 'Standard' })
    expect(await within(hd).findByText('BluRay 1080p · H.264 · DTS 5.1 · English, German · 8.0 GB')).toBeInTheDocument()
    expect(within(hd).getByText('Imported 3 days ago')).toBeInTheDocument()
    await userEvent.click(within(hd).getByRole('button', { name: 'File details' }))
    const pop = await screen.findByRole('dialog', { name: 'Standard file' })
    expect(pop).toHaveTextContent('/data/media/movies/Paddington (2014)/Paddington.mkv')
    // The same popover an episode cell opens: audio, group, Score and each Custom Format with its points.
    expect(within(pop).getByText('DTS 5.1 · English, German')).toBeInTheDocument()
    expect(within(pop).getByText(/from GRP$/)).toBeInTheDocument()
    expect(within(pop).getByText('2,290')).toBeInTheDocument()
    expect(within(pop).getByText('Remux Tier 01 +2300')).toBeInTheDocument()
    expect(within(pop).getByText('x265 \u221210')).toBeInTheDocument()
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
    expect(await within(hd).findByText('Wanted for 12 days')).toBeInTheDocument()
    expect(within(hd).getByRole('button', { name: 'Search Standard now' })).toBeEnabled()
    expect(within(pane).getByRole('button', { name: 'Standard: Wanted' })).toBeInTheDocument()
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
    ).toEqual(['Search now', 'Manual search…', 'Change Profile…HD', 'Why is it Wanted?', 'Delete files…No file to delete', 'Remove Version…'])
    expect(within(menu).getByRole('menuitem', { name: /Delete files/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keep a Series Version’s menu to Search now, Manual search, Change Profile and Remove Version', async () => {
    fakeSeries()
    const pane = await openTitle(/breaking bad/i)

    await userEvent.click(await within(pane).findByRole('button', { name: 'Standard Version actions' }))
    const menu = screen.getByRole('menu', { name: 'Standard Version actions' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Search now', 'Manual search…', 'Change Profile…HD', 'Why is it Wanted?', 'Remove Version…'])
  })
})

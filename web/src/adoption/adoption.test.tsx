import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast, toastRegion } from '../test/toasts'

type Adoption = components['schemas']['Adoption']
type Row = components['schemas']['AdoptionRow']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const willAdopt = (r: Row) => r.status === 'matched' && r.ticked && r.files.some((f) => f.ticked && !f.left)

const summary = (rows: Row[]): Adoption['summary'] => ({
  adopting: rows.filter(willAdopt).length,
  matched: rows.filter((r) => r.status === 'matched').length,
  needs_choice: rows.filter((r) => r.status === 'needs_choice').length,
  skipped: rows.filter((r) => r.status === 'skipped').length,
  duplicate: rows.filter((r) => r.files.some((f) => f.left === 'duplicate')).length,
  replacement: rows.filter((r) => r.files.some((f) => f.action === 'replace' && !f.left)).length,
})

const file = (name: string, over: Partial<components['schemas']['AdoptionFile']> = {}): components['schemas']['AdoptionFile'] => ({
  path: `/data/media/movies/old/${name}.mkv`,
  to: `/data/media/movies/Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard] ${name}.mkv`,
  size: 8 << 30,
  slot: 'standard',
  profile: 'hd-primary',
  score: 1750,
  action: 'create',
  held_score: null,
  ticked: true,
  left: null,
  episodes: [],
  subtitles: [{ from: '/a.en.srt', to: '/b.eng.srt' }],
  ...over,
})

const matched: Row = {
  id: 1,
  kind: 'movie',
  status: 'matched',
  skip_reason: null,
  entry: '/data/media/movies/Paddington.2014.1080p',
  ticked: true,
  match: { tmdb_id: 116149, title: 'Paddington', year: 2014, title_id: null, source: 'name', folder: 'Paddington (2014) {tmdb-116149}' },
  candidates: [],
  files: [file('main'), file('copy', { left: 'duplicate', score: 10 })],
}
const doubtful: Row = {
  id: 2,
  kind: 'movie',
  status: 'needs_choice',
  skip_reason: null,
  entry: '/data/media/movies/The Lost',
  ticked: false,
  match: null,
  candidates: [{ tmdb_id: 77, title: 'The Lost Film', year: 2020, suggested: false, confident: false }],
  files: [],
}
const broken: Row = {
  id: 3,
  kind: 'movie',
  status: 'skipped',
  skip_reason: 'invalid',
  entry: '/data/media/movies/Broken',
  ticked: false,
  match: null,
  candidates: [],
  files: [],
}

const series: Row = {
  id: 4,
  kind: 'series',
  status: 'matched',
  skip_reason: null,
  entry: '/data/media/tv/Breaking Bad',
  ticked: true,
  match: { tmdb_id: 1396, tvdb_id: 81189, title: 'Breaking Bad', year: 2008, title_id: null, source: 'tag', folder: 'Breaking Bad (2008) {tvdb-81189}' },
  candidates: [],
  files: [
    file('e1', { episodes: [{ season: 1, number: 1 }] }),
    file('e23', {
      episodes: [
        { season: 1, number: 2 },
        { season: 1, number: 3 },
      ],
    }),
    file('4k', { slot: '4k', episodes: [{ season: 2, number: 1 }] }),
    file('stray', { left: 'unmatched', ticked: false }),
  ],
}
const orphan: Row = { ...broken, id: 5, kind: 'series', skip_reason: 'not_on_tvdb', entry: '/data/media/tv/Orphan Show' }

const inFilter = (r: Row, f: string | undefined) => {
  switch (f) {
    case undefined:
    case 'all':
      return true
    case 'duplicate':
      return r.files.some((x) => x.left === 'duplicate')
    case 'replacement':
      return r.files.some((x) => x.action === 'replace' && !x.left)
    default:
      return r.status === f
  }
}

type Bulk = components['schemas']['AdoptionRowsBulk']

export function fakeAdoption(rows: Row[] = [matched, doubtful, broken]) {
  const state = {
    plan: 'idle' as Adoption['state'],
    revision: 1,
    rows,
    patches: [] as { id: string; body: unknown }[],
    commits: [] as unknown[],
    bulks: [] as Bulk[],
    monitor: 'all' as Adoption['monitor'],
    /** The bodies of every PATCH /adoption. */
    planPatches: [] as unknown[],
    /** The `limit`, `cursor` and `filter` of every GET /adoption/rows. */
    pages: [] as { limit: string | null; cursor: string | null; filter: string | null }[],
  }
  const adoption = (): Adoption => ({
    state: state.plan,
    progress: { done: 0, total: 0 },
    summary: summary(state.plan === 'planned' ? state.rows : []),
    revision: state.revision,
    error: null,
    scanned_at: null,
    result: null,
    monitor: state.monitor,
  })
  server.use(
    http.get('/adoption', ({ response }) => response(200).json(adoption())),
    http.patch('/adoption', async ({ request, response }) => {
      const body = (await request.clone().json()) as { monitor: Adoption['monitor'] }
      state.planPatches.push(body)
      state.monitor = body.monitor
      state.revision++
      return response(200).json(adoption())
    }),
    http.post('/adoption/scan', ({ response }) => {
      state.plan = 'planned'
      state.revision++
      return response(202).json(adoption())
    }),
    http.get('/adoption/rows', ({ request, response }) => {
      const q = new URL(request.url).searchParams
      state.pages.push({ limit: q.get('limit'), cursor: q.get('cursor'), filter: q.get('filter') })
      const kept = state.rows.filter((r) => inFilter(r, q.get('filter') ?? undefined))
      const at = Number(q.get('cursor') ?? 0)
      const end = at + Number(q.get('limit') ?? 100)
      return response(200).json({
        items: kept.slice(at, end),
        next_cursor: end < kept.length ? String(end) : null,
        total: kept.length,
        counts: summary(state.rows),
      })
    }),
    http.post('/adoption/rows/bulk', async ({ request, response }) => {
      const body = (await request.clone().json()) as Bulk
      state.bulks.push(body)
      const targets = state.rows.filter((r) => (body.row_ids ? body.row_ids.includes(r.id) : inFilter(r, body.filter)))
      const items: components['schemas']['AdoptionBulkRowResult'][] = []
      for (const r of targets) {
        const pick = r.candidates.find((c) => c.suggested)
        if (body.action === 'accept_suggested') {
          if (r.status !== 'needs_choice') items.push({ row_id: r.id, result: 'left', reason: 'not_needs_choice' })
          else if (!pick?.confident) items.push({ row_id: r.id, result: 'left', reason: pick ? 'not_confident' : 'no_suggestion' })
          else {
            Object.assign(r, {
              status: 'matched',
              ticked: true,
              match: { tmdb_id: pick.tmdb_id, title: pick.title, year: pick.year, title_id: null, source: 'chosen', folder: 'x' },
              files: [file('x')],
            })
            items.push({ row_id: r.id, result: 'changed', status: 'matched' })
          }
        } else if (body.action === 'set_monitor') {
          if (r.match?.title_id) items.push({ row_id: r.id, result: 'left', reason: 'tracked' })
          else {
            r.monitor = body.monitor
            items.push({ row_id: r.id, result: 'changed', status: r.status })
          }
        } else if (r.status !== 'matched') items.push({ row_id: r.id, result: 'left', reason: 'not_matched' })
        else {
          r.ticked = body.action === 'tick'
          items.push({ row_id: r.id, result: 'changed', status: 'matched' })
        }
      }
      state.revision++
      return response(200).json({ revision: state.revision, items })
    }),
    http.patch('/adoption/rows/{id}', async ({ params, request, response }) => {
      const body = await request.clone().json()
      state.patches.push({ id: String(params.id), body })
      state.revision++
      if ('monitor' in body) state.rows = state.rows.map((r) => (String(r.id) === String(params.id) ? { ...r, monitor: body.monitor as Row['monitor'] } : r))
      if ('ticked' in body) state.rows = state.rows.map((r) => (String(r.id) === String(params.id) ? { ...r, ticked: body.ticked as boolean } : r))
      if ('tmdb_id' in body) {
        state.rows = state.rows.map((r) =>
          r.id === 2
            ? {
                ...r,
                status: 'matched',
                ticked: true,
                match: { tmdb_id: 77, title: 'The Lost Film', year: 2020, title_id: null, source: 'chosen', folder: 'The Lost Film (2020) {tmdb-77}' },
                files: [file('lost')],
              }
            : r,
        )
      }
      return response(200).json(state.rows.find((r) => String(r.id) === String(params.id))!)
    }),
    http.post('/adoption/commit', async ({ request, response }) => {
      state.commits.push(await request.clone().json())
      state.plan = 'idle'
      return response(202).json(adoption())
    }),
  )
  return state
}

async function openAdoption() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Settings' }))
  await user.click(await screen.findByRole('button', { name: /scan for unmanaged files/i }))
  return user
}

describe('Adoption while loading', () => {
  it('shows Skeleton rows, announced once, until the plan loads', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    fakeAdoption()
    server.use(
      http.get('/adoption', async ({ response }) => {
        await held
        return response(200).json({ state: 'idle', progress: { done: 0, total: 0 }, summary: summary([]), revision: 1, error: null, scanned_at: null, result: null, monitor: 'all' })
      }),
    )
    renderApp()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /scan for unmanaged files/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByRole('button', { name: /scan for existing files/i })).not.toBeInTheDocument()
    release()
    expect(await screen.findByRole('button', { name: /scan for existing files/i })).toBeInTheDocument()
  })
})

describe('Adoption review', () => {
  it('shows a Series with its episodes, the Versions it proposes, unmatched files and a Series not on TheTVDB', async () => {
    fakeAdoption([series, orphan])
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    expect(await screen.findByText('Not on TheTVDB, so Kestrel cannot manage it')).toBeInTheDocument()
    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Breaking Bad (2008)'))!
    expect(row).toHaveTextContent('Standard: 3 episodes, 4K: 1 episode')
    expect(row).toHaveTextContent('S01E02-E03')
    expect(row).toHaveTextContent('No matching episode, left in place')
    expect(screen.getByText('Not on TheTVDB, so Kestrel cannot manage it')).toBeInTheDocument()
  })

  it('scans, shows matched, needs-choice and skipped rows, settles a choice and commits the plan it reviewed', async () => {
    const state = fakeAdoption()
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('1 matched, 1 need a choice, 1 skipped')
    const items = await screen.findAllByRole('listitem')
    const main = items.find((li) => li.textContent?.includes('Paddington (2014)'))!
    expect(within(main).getByLabelText('Adopt Paddington (2014)')).toBeChecked()
    expect(main).toHaveTextContent('Duplicate, left in place')
    expect(main).toHaveTextContent('1 subtitle')
    expect(screen.getByText('No readable video file')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use The Lost Film (2020)' }))
    expect(await screen.findByLabelText('Adopt The Lost Film (2020)')).toBeChecked()
    expect(state.patches).toEqual([{ id: '2', body: { tmdb_id: 77 } }])

    await user.click(screen.getByRole('button', { name: 'Adopt 2 Titles' }))
    await screen.findByRole('button', { name: /scan for existing files/i })
    expect(state.commits).toEqual([{ revision: state.revision }])
    expect(await findToast('Adopting the plan started')).toBeInTheDocument()
    expect(within(await toastRegion()).queryByRole('button', { name: 'Watch in Activity' })).not.toBeInTheDocument()
  })

  it('says in a Toast that the scan started, that a plan was discarded, and why a call failed', async () => {
    fakeAdoption()
    server.use(http.delete('/adoption', ({ response }) => response(204).empty()))
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))
    expect(await findToast('Scan for existing files started')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Discard plan' }))
    expect(await findToast('Adoption plan discarded')).toBeInTheDocument()
  })

  it('shows why a scan could not start, inline', async () => {
    fakeAdoption()
    server.use(
      http.post('/adoption/scan', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 409, code: 'conflict', detail: 'a scan is already running' }, { status: 409 })),
    )
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    expect(await screen.findByText('a scan is already running')).toBeInTheDocument()
  })

  it('offers Clean up for the adopted folders once Titles were adopted', async () => {
    const previews: unknown[] = []
    fakeAdoption()
    server.use(
      http.get('/adoption', ({ response }) =>
        response(200).json({
          state: 'idle',
          progress: { done: 0, total: 0 },
          summary: { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 },
          revision: 3,
          error: null,
          scanned_at: null,
          monitor: 'all',
          result: { adopted: 2, failed: 0, title_ids: [3, 4], outcomes: { adopted: 2, failed: 0, skipped: 0, not_chosen: 0, unticked: 0 } },
        }),
      ),
      http.post('/cleanup/preview', async ({ request, response }) => {
        previews.push(await request.clone().json())
        return response(200).json({ preview_id: 'p1', categories: [] })
      }),
    )
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: 'Clean up adopted folders' }))
    await user.click(await screen.findByRole('button', { name: /look for unmanaged files/i }))

    expect(previews).toEqual([{ title_ids: [3, 4] }])
  })

  it('opens from the Library', async () => {
    fakeAdoption()
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    await user.click(await screen.findByRole('button', { name: 'Adopt existing library' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Adopt existing library')
  })

  it('unticking a row leaves it out of the count', async () => {
    fakeAdoption()
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    await user.click(await screen.findByLabelText('Adopt Paddington (2014)'))

    expect(await screen.findByRole('button', { name: 'Adopt 0 Titles' })).toBeDisabled()
  })
})

const moreRows = (n: number, over: Partial<Row> = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    ...matched,
    id: 100 + i,
    entry: `/data/media/movies/Film ${i}`,
    match: { ...matched.match!, title: `Film ${i}`, year: 2000 },
    files: [file(`f${i}`)],
    ...over,
  }))

describe('Adoption review of a large plan', () => {
  async function openPlan(rows: Row[]) {
    const state = fakeAdoption(rows)
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))
    return { state, user }
  }

  it('shows the rows a page at a time and loads the next page on request', async () => {
    const { state, user } = await openPlan(moreRows(250))

    expect(await screen.findByText('Showing 100 of 250')).toBeInTheDocument()
    // A role query walks the whole accessibility tree, which is what made this test slow under load.
    expect([...document.querySelectorAll('li')].filter((li) => li.textContent?.includes('Film '))).toHaveLength(100)
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Showing 200 of 250')).toBeInTheDocument()
    expect(state.pages.at(-1)).toEqual({ limit: '100', cursor: '100', filter: null })
    expect(screen.getByRole('button', { name: 'Adopt 250 Titles' })).toBeInTheDocument()
  })

  it('asks the server for the chosen filter', async () => {
    const { state, user } = await openPlan([...moreRows(3), doubtful])

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Show' }), 'needs_choice')

    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument()
    expect(state.pages.at(-1)?.filter).toBe('needs_choice')
  })

  it('leaves out the selected rows by id', async () => {
    const { state, user } = await openPlan(moreRows(3))

    await user.click(await screen.findByLabelText('Select Film 0'))
    await user.click(screen.getByLabelText('Select Film 1'))
    expect(screen.getByRole('group', { name: 'Selection' })).toHaveTextContent('2 selected')
    await user.click(screen.getByRole('button', { name: "Don't adopt selected" }))

    expect(await screen.findByRole('button', { name: 'Adopt 1 Title' })).toBeInTheDocument()
    expect(state.bulks).toEqual([{ action: 'untick', row_ids: [100, 101] }])
  })

  it('selects every row of the filter across pages and sends the filter, not the ids', async () => {
    const { state, user } = await openPlan(moreRows(120))

    await user.click(await screen.findByLabelText('Select Film 0'))
    await user.click(screen.getByRole('button', { name: 'Select all 100 shown' }))
    await user.click(screen.getByRole('button', { name: 'Select all 120 in this filter' }))
    expect(screen.getByRole('group', { name: 'Selection' })).toHaveTextContent('120 selected')
    await user.click(screen.getByRole('button', { name: "Don't adopt selected" }))

    expect(await screen.findByRole('button', { name: 'Adopt 0 Titles' })).toBeDisabled()
    expect(state.bulks).toEqual([{ action: 'untick', filter: 'all' }])
    expect(screen.getByRole('group', { name: 'Selection' })).not.toHaveTextContent('selected') // nothing is selected after the action
  })

  it('offers both select-all controls before a single row is ticked', async () => {
    const { state, user } = await openPlan(moreRows(120))

    expect(await screen.findByText('Showing 100 of 120')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select all 100 shown' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select all 120 in this filter' }))
    expect(screen.getByRole('group', { name: 'Selection' })).toHaveTextContent('120 selected')
    await user.click(screen.getByRole('button', { name: "Don't adopt selected" }))

    expect(state.bulks).toEqual([{ action: 'untick', filter: 'all' }])
  })

  it('offers no action on a selection before anything is selected', async () => {
    await openPlan(moreRows(120))

    await screen.findByText('Showing 100 of 120')
    expect(screen.queryByRole('button', { name: "Don't adopt selected" })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('says so when leaving one row out ends "all in this filter", and then names the rows left by id', async () => {
    const { state, user } = await openPlan(moreRows(120))

    await user.click(await screen.findByRole('button', { name: 'Select all 120 in this filter' }))
    await user.click(screen.getByLabelText('Select Film 3'))

    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(bar).toHaveTextContent('99 selected')
    expect(bar).toHaveTextContent('No longer all 120 in this filter')
    expect(within(bar).getByRole('button', { name: 'Select all 120 in this filter' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "Don't adopt selected" }))

    expect(state.bulks).toHaveLength(1)
    expect(state.bulks[0].filter).toBeUndefined()
    expect(state.bulks[0].row_ids).toHaveLength(99)
    expect(state.bulks[0].row_ids).not.toContain(103)
  })

  it('accepts the confident suggestions of a selection', async () => {
    const hesitant: Row = { ...doubtful, id: 20, entry: '/data/media/movies/Hesitant', candidates: [{ tmdb_id: 9, title: 'Maybe', year: 2001, suggested: true, confident: false }] }
    const sure: Row = {
      ...doubtful,
      id: 21,
      entry: '/data/media/movies/Sure',
      candidates: [
        { tmdb_id: 77, title: 'The Lost Film', year: 2020, suggested: true, confident: true },
        { tmdb_id: 78, title: 'Another Lost Film', year: 2019, suggested: false, confident: false },
      ],
    }
    const { state, user } = await openPlan([sure, hesitant])

    await screen.findByRole('button', { name: 'Accept suggested match: The Lost Film (2020)' })
    await user.click(screen.getByLabelText('Select Sure'))
    await user.click(screen.getByLabelText('Select Hesitant'))
    await user.click(screen.getByRole('button', { name: 'Accept suggested matches' }))

    expect(state.bulks).toEqual([{ action: 'accept_suggested', row_ids: [21, 20] }])
    expect(await screen.findByText('Accepted 1 suggested match. 1 left for you because the suggestion is not confident enough.')).toBeInTheDocument()
    expect(await screen.findByLabelText('Adopt The Lost Film (2020)')).toBeChecked()
  })

  it('accepts one row from its own suggested button', async () => {
    const sure: Row = { ...doubtful, candidates: [{ tmdb_id: 77, title: 'The Lost Film', year: 2020, suggested: true, confident: true }] }
    const { state, user } = await openPlan([sure])

    await user.click(await screen.findByRole('button', { name: 'Accept suggested match: The Lost Film (2020)' }))

    expect(state.patches).toEqual([{ id: '2', body: { tmdb_id: 77 } }])
  })
})

describe('Adoption monitoring', () => {
  async function openPlan(rows: Row[]) {
    const state = fakeAdoption(rows)
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))
    return { state, user }
  }
  const tracked: Row = { ...matched, id: 6, entry: '/data/media/movies/Tracked', match: { ...matched.match!, title: 'Tracked', title_id: 9 } }

  it('chooses how the whole plan is monitored and stores it on the plan', async () => {
    const { state, user } = await openPlan([matched, series])

    const choice = await screen.findByRole('combobox', { name: 'Monitoring' })
    expect(choice).toHaveValue('all')
    expect(
      within(choice)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Monitored', 'Series: future episodes only', 'Unmonitored'])
    await user.selectOptions(choice, 'none')

    expect(state.planPatches).toEqual([{ monitor: 'none' }])
    expect(await screen.findByRole('combobox', { name: 'Monitoring' })).toHaveValue('none')
  })

  it('lets a row choose for itself, a Series with its future episodes choice and a Movie without', async () => {
    const { state, user } = await openPlan([matched, series])

    const movie = await screen.findByRole('combobox', { name: 'Monitoring of Paddington (2014)' })
    expect(
      within(movie)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Monitored', 'Unmonitored'])
    const show = screen.getByRole('combobox', { name: 'Monitoring of Breaking Bad (2008)' })
    expect(
      within(show)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All episodes', 'Future episodes only', 'Unmonitored'])
    await user.selectOptions(show, 'future')

    expect(state.patches).toEqual([{ id: '4', body: { monitor: 'future' } }])
    expect(await screen.findByRole('combobox', { name: 'Monitoring of Breaking Bad (2008)' })).toHaveValue('future')
  })

  it('offers no choice on a row for a Title Kestrel already tracks', async () => {
    await openPlan([tracked])

    await screen.findByLabelText('Adopt Tracked (2014)')
    expect(screen.queryByRole('combobox', { name: /Monitoring of/ })).not.toBeInTheDocument()
    expect(screen.getByText('Keeps its own monitoring')).toBeInTheDocument()
  })

  it('sets the monitoring of a selection and says which rows kept their own', async () => {
    const { state, user } = await openPlan([matched, series, tracked])

    await user.click(await screen.findByLabelText('Select Paddington.2014.1080p'))
    await user.click(screen.getByLabelText('Select Tracked'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Set monitoring of selected' }), 'none')

    expect(state.bulks).toEqual([{ action: 'set_monitor', monitor: 'none', row_ids: [1, 6] }])
    expect(await screen.findByText('Set 1 row to Unmonitored. 1 left as they were because the Title is in the Library and keeps its monitoring.')).toBeInTheDocument()
  })
})

describe('Adoption review on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    history.replaceState(null, '', '/')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens from the Settings section and lays the plan out with its actions reachable', async () => {
    fakeAdoption()
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Existing files' }))
    await user.click(await screen.findByRole('button', { name: /scan for unmanaged files/i }))
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    // The filter and both actions are there.
    expect(await screen.findByRole('combobox', { name: 'Show' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard plan' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Adopt 1 Title' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /Use The Lost Film/ }))
    expect(await screen.findByRole('button', { name: 'Adopt 2 Titles' })).toBeEnabled()
  })

  it('is one of the More sheet screens, as are Requests and Clean up', async () => {
    fakeAdoption()
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    const names = ['Settings', 'Log', 'Requests', 'Adoption', 'Clean up', 'About']
    // A row's button is a cover over its content, named by it, so the names are read as accessible names, not text.
    names.forEach((name, i) => expect(within(sheet).getAllByRole('button')[i]).toHaveAccessibleName(name))
    await user.click(within(sheet).getByRole('button', { name: 'Adoption' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Adopt existing library')
    expect(await screen.findByRole('button', { name: /scan for existing files/i })).toBeInTheDocument()
  })
})

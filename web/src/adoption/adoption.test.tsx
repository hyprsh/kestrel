import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Adoption = components['schemas']['Adoption']
type Row = components['schemas']['AdoptionRow']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const summary = (rows: Row[]): Adoption['summary'] => ({
  matched: rows.filter((r) => r.status === 'matched').length,
  needs_choice: rows.filter((r) => r.status === 'needs_choice').length,
  skipped: rows.filter((r) => r.status === 'skipped').length,
  duplicate: rows.filter((r) => r.files.some((f) => f.left === 'duplicate')).length,
  replacement: rows.filter((r) => r.files.some((f) => f.action === 'replace' && !f.left)).length,
})

const file = (name: string, over: Partial<components['schemas']['AdoptionFile']> = {}): components['schemas']['AdoptionFile'] => ({
  path: `/data/media/movies/old/${name}.mkv`,
  to: `/data/media/movies/Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [HD] ${name}.mkv`,
  size: 8 << 30,
  slot: 'hd',
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
  candidates: [{ tmdb_id: 77, title: 'The Lost Film', year: 2020 }],
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
    file('e23', { episodes: [{ season: 1, number: 2 }, { season: 1, number: 3 }] }),
    file('uhd', { slot: 'uhd', episodes: [{ season: 2, number: 1 }] }),
    file('stray', { left: 'unmatched', ticked: false }),
  ],
}
const orphan: Row = { ...broken, id: 5, kind: 'series', skip_reason: 'not_on_tvdb', entry: '/data/media/tv/Orphan Show' }

export function fakeAdoption(rows: Row[] = [matched, doubtful, broken]) {
  const state = {
    plan: 'idle' as Adoption['state'],
    revision: 1,
    rows,
    patches: [] as { id: string; body: unknown }[],
    commits: [] as unknown[],
  }
  const adoption = (): Adoption => ({
    state: state.plan,
    progress: { done: 0, total: 0 },
    summary: summary(state.plan === 'planned' ? state.rows : []),
    revision: state.revision,
    error: null,
    scanned_at: null,
    result: null,
  })
  server.use(
    http.get('/adoption', ({ response }) => response(200).json(adoption())),
    http.post('/adoption/scan', ({ response }) => {
      state.plan = 'planned'
      state.revision++
      return response(202).json(adoption())
    }),
    http.get('/adoption/rows', ({ response }) => response(200).json({ items: state.rows })),
    http.patch('/adoption/rows/{id}', async ({ params, request, response }) => {
      const body = await request.clone().json()
      state.patches.push({ id: String(params.id), body })
      state.revision++
      if ('ticked' in body) state.rows = state.rows.map((r) => (String(r.id) === String(params.id) ? { ...r, ticked: body.ticked as boolean } : r))
      if ('tmdb_id' in body) {
        state.rows = state.rows.map((r) =>
          r.id === 2
            ? { ...r, status: 'matched', ticked: true, match: { tmdb_id: 77, title: 'The Lost Film', year: 2020, title_id: null, source: 'chosen', folder: 'The Lost Film (2020) {tmdb-77}' }, files: [file('lost')] }
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

describe('Adoption review', () => {
  it('shows a Series with its episodes, the Versions it proposes, unmatched files and a Series not on TheTVDB', async () => {
    fakeAdoption([series, orphan])
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    const row = (await screen.findAllByRole('listitem')).find((li) => li.textContent?.includes('Breaking Bad (2008)'))!
    expect(row).toHaveTextContent('HD: 3 episodes, UHD: 1 episode')
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
  })

  it('offers Clean up for the adopted folders once Titles were adopted', async () => {
    const previews: unknown[] = []
    fakeAdoption()
    server.use(
      http.get('/adoption', ({ response }) =>
        response(200).json({
          state: 'idle',
          progress: { done: 0, total: 0 },
          summary: { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0 },
          revision: 3,
          error: null,
          scanned_at: null,
          result: { adopted: 2, failed: 0, title_ids: [3, 4] },
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

  it('unticking a row leaves it out of the count', async () => {
    fakeAdoption()
    const user = await openAdoption()
    await user.click(await screen.findByRole('button', { name: /scan for existing files/i }))

    await user.click(await screen.findByLabelText('Adopt Paddington (2014)'))

    expect(await screen.findByRole('button', { name: 'Adopt 0 Titles' })).toBeDisabled()
  })
})

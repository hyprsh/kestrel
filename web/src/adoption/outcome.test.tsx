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
type Ended = components['schemas']['AdoptionFinalOutcome']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const none = { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 }

const kept = (id: number, outcome: Ended, over: Partial<Row> = {}): Row => ({
  id,
  kind: 'movie',
  status: outcome === 'skipped' ? 'skipped' : outcome === 'not_chosen' ? 'needs_choice' : 'matched',
  skip_reason: null,
  entry: `/data/media/movies/${outcome} ${id}`,
  ticked: outcome === 'adopted' || outcome === 'failed',
  match: null,
  candidates: [],
  files: [],
  outcome,
  ...over,
})

const rows: Row[] = [
  kept(1, 'adopted'),
  kept(2, 'failed', { error: 'none of the files could be adopted' }),
  kept(3, 'skipped', { skip_reason: 'no_enabled_profile' }),
  kept(4, 'not_chosen'),
  kept(5, 'unticked'),
]

function finished() {
  const state = { retries: 0, scans: 0, reopens: 0, plan: 'idle' as Adoption['state'], error: null as string | null, cleanups: [] as unknown[] }
  /** The kept rows: a Try again or a reopen puts one back under review, the rest and the result stay. */
  const counts = () => ({ adopted: 1, failed: state.plan === 'planned' ? 0 : 1, skipped: 1, not_chosen: state.plan === 'planned' ? 0 : 1, unticked: 1 })
  const plan = (): Adoption => ({
    state: state.plan,
    progress: { done: 0, total: 0 },
    summary: state.plan === 'planned' ? { ...none, needs_choice: 1 } : none,
    monitor: 'all',
    revision: 5,
    error: state.error,
    scanned_at: null,
    result: state.plan === 'idle' || state.plan === 'planned' ? { adopted: 1, failed: 1, title_ids: [9], outcomes: counts() } : null,
  })
  server.use(
    http.get('/adoption', ({ response }) => response(200).json(plan())),
    http.get('/adoption/rows', ({ request, response }) => {
      const outcome = new URL(request.url).searchParams.get('outcome')
      const items = rows.filter((r) => (outcome ? r.outcome === outcome : state.plan === 'planned' && r.outcome === 'not_chosen'))
      return response(200).json({ items, next_cursor: null, total: items.length, counts: none })
    }),
    http.post('/adoption/retry', ({ response }) => {
      state.retries++
      state.plan = 'planned'
      return response(202).json(plan())
    }),
    http.post('/adoption/reopen', ({ response }) => {
      state.reopens++
      state.plan = 'planned'
      return response(200).json(plan())
    }),
    http.post('/adoption/scan', ({ response }) => {
      state.scans++
      state.plan = 'planned'
      return response(202).json(plan())
    }),
    http.post('/cleanup/preview', async ({ request, response }) => {
      state.cleanups.push(await request.clone().json())
      return response(200).json({ preview_id: 'p1', categories: [] })
    }),
  )
  return state
}

async function openAdoption() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Settings' }))
  await user.click(await screen.findByRole('button', { name: /scan for unmanaged files|review the adoption plan/i }))
  return user
}

describe('The Adoption summary after a commit', () => {
  it('lists what was not adopted in groups with a count, each entry with its folder and reason', async () => {
    finished()
    await openAdoption()

    const failed = await screen.findByRole('region', { name: 'Failed (1)' })
    expect(await within(failed).findByText('/data/media/movies/failed 2')).toBeInTheDocument()
    expect(within(failed).getByText('none of the files could be adopted')).toBeInTheDocument()
    const skipped = screen.getByRole('region', { name: 'Skipped (1)' })
    expect(await within(skipped).findByText('/data/media/movies/skipped 3')).toBeInTheDocument()
    expect(within(skipped).getByText('No enabled Profile for its Slot')).toBeInTheDocument()
    const notChosen = screen.getByRole('region', { name: 'Not chosen (1)' })
    expect(await within(notChosen).findByText('/data/media/movies/not_chosen 4')).toBeInTheDocument()
    const left = screen.getByRole('region', { name: 'Left out (1)' })
    expect(await within(left).findByText('/data/media/movies/unticked 5')).toBeInTheDocument()
    expect(screen.queryByText('/data/media/movies/adopted 1')).not.toBeInTheDocument()
  })

  it('tries the failed entries again without scanning', async () => {
    const state = finished()
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(state.retries).toBe(1)
    expect(state.scans).toBe(0)
  })

  it('reopens the entries nobody chose in the plan without scanning, keeping the rest of the summary', async () => {
    const state = finished()
    const user = await openAdoption()

    const notChosen = await screen.findByRole('region', { name: 'Not chosen (1)' })
    await user.click(within(notChosen).getByRole('button', { name: 'Reopen to choose' }))

    expect(state.reopens).toBe(1)
    expect(state.scans).toBe(0)
    expect(await screen.findByText('0 matched, 1 need a choice, 0 skipped')).toBeInTheDocument()
    // The previous result and the other groups are still there, the reopened entry is under review.
    expect(screen.getByText('Adopted 1 Title, 1 could not be adopted.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Skipped (1)' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Left out (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Not chosen/ })).not.toBeInTheDocument()
  })

  it('keeps the rows and the result on show when Try again could not plan', async () => {
    const state = finished()
    state.error = 'ffprobe is not installed, so files cannot be checked'
    await openAdoption()

    expect(await screen.findByText('ffprobe is not installed, so files cannot be checked')).toBeInTheDocument()
    expect(screen.getByText('Adopted 1 Title, 1 could not be adopted.')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Failed (1)' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Skipped (1)' })).toBeInTheDocument()
  })

  it('links to Clean up for the files left behind', async () => {
    const state = finished()
    const user = await openAdoption()

    await user.click(await screen.findByRole('button', { name: 'Clean up leftover files' }))
    await user.click(await screen.findByRole('button', { name: /look for unmanaged files/i }))

    expect(state.cleanups).toEqual([{}])
  })

  it('shows no group for outcomes that did not happen', async () => {
    finished()
    server.use(
      http.get('/adoption', ({ response }) =>
        response(200).json({
          state: 'idle',
          progress: { done: 0, total: 0 },
          summary: none,
          monitor: 'all',
          revision: 5,
          error: null,
          scanned_at: null,
          result: { adopted: 3, failed: 0, title_ids: [1], outcomes: { adopted: 3, failed: 0, skipped: 0, not_chosen: 0, unticked: 0 } },
        }),
      ),
    )
    await openAdoption()

    expect(await screen.findByText(/Adopted 3 Titles/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /\(\d+\)$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clean up leftover files' })).not.toBeInTheDocument()
  })
})

describe('The current item of a running scan or commit', () => {
  const running = (state: 'scanning' | 'committing', current: components['schemas']['AdoptionCurrent']) =>
    server.use(
      http.get('/adoption', ({ response }) =>
        response(200).json({ state, monitor: 'all', progress: { done: 120, total: 450, current }, summary: none, revision: 2, error: null, scanned_at: null, result: null }),
      ),
    )

  it('names the entry being scanned, the step and the file count', async () => {
    running('scanning', { entry: '/data/media/tv/Breaking Bad', step: 'probing', files: 62 })
    await openAdoption()

    expect(await screen.findByText('Scanning… 120 of 450')).toBeInTheDocument()
    expect(screen.getByText('Reading 62 files of /data/media/tv/Breaking Bad')).toBeInTheDocument()
  })

  it('names the Title being adopted, not its folder, and what is happening to its files', async () => {
    running('committing', { entry: '/data/media/movies/Paddington.2014.1080p', step: 'moving', files: 2, title: 'Paddington (2014)' })
    await openAdoption()

    expect(await screen.findByText('Adopting Paddington (2014) — moving 2 files')).toBeInTheDocument()
    expect(screen.queryByText(/Paddington\.2014\.1080p/)).not.toBeInTheDocument()
  })

  it('says what it is doing in plain words when the step covers no files', async () => {
    running('scanning', { entry: '/data/media/movies/Dune', step: 'matching' })
    await openAdoption()

    expect(await screen.findByText('Finding the Title for /data/media/movies/Dune')).toBeInTheDocument()
  })
})

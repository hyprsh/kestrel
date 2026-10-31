import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { TrashForm } from './Trash'
import { http } from '../test/handlers'
import { server } from '../test/server'

async function openSettings() {
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
}
const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrashForm />
    </QueryClientProvider>,
  )

type Job = components['schemas']['Job']
const trashJob = (over: Partial<Job> = {}): Job => ({
  name: 'trash',
  status: 'idle',
  disabled_by: null,
  runnable: false,
  last_run: null,
  next_at: null,
  schedule: { every_ms: 3_600_000, busy_every_ms: null, runs_every_ms: 86_400_000 },
  progress: null,
  outcome: null,
  ...over,
})

describe('Update from TRaSH', () => {
  it('says in a Toast that it runs in the background, with a link to Activity, and keeps no line under the button', async () => {
    server.use(http.post('/trash/update', ({ response }) => response(202).empty()))
    await openSettings()

    await userEvent.click(await screen.findByRole('button', { name: 'Update from TRaSH' }))

    const toasts = await screen.findByRole('region', { name: 'Notifications' })
    expect(await within(toasts).findByText('Updating from TRaSH in the background')).toBeInTheDocument()
    expect(within(toasts).getByRole('button', { name: 'Watch in Activity' })).toBeInTheDocument()
    expect(screen.queryByText(/already up to date|^Updated\.$/i)).not.toBeInTheDocument()
  })

  it('says in a Toast when the request itself failed', async () => {
    server.use(http.post('/trash/update', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'broken' }, { status: 500 })))
    await openSettings()

    await userEvent.click(await screen.findByRole('button', { name: 'Update from TRaSH' }))

    const toasts = await screen.findByRole('region', { name: 'Notifications' })
    expect(await within(toasts).findByText(/update from trash failed/i)).toBeInTheDocument()
  })

  it.each([
    ['updated', 'Updated to TRaSH commit abc1234'],
    ['up_to_date', 'Already up to date with TRaSH'],
    ['rejected', 'TRaSH’s newest set was rejected. The previous one stays in use.'],
    ['unreachable', 'Could not reach TRaSH. Try again later.'],
  ] as const)('reports a pass that ends %s in a Toast on whatever screen the user is on, not the outcome from before', async (kind, text) => {
    const state: { job: Job } = { job: trashJob({ outcome: { kind: 'up_to_date', text: 'old news', at: '2026-10-18T09:00:00Z' } }) }
    server.use(http.get('/jobs', ({ response }) => response(200).json({ items: [state.job] })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    await userEvent.click(await screen.findByRole('tab', { name: /^Background Jobs/ }))
    await screen.findByRole('region', { name: /^Background jobs/ })
    const toasts = await screen.findByRole('region', { name: 'Notifications' })
    expect(within(toasts).queryByText('old news')).not.toBeInTheDocument()

    state.job = trashJob({ outcome: { kind, text, at: '2026-10-18T10:00:00Z' } })
    await client.invalidateQueries({ queryKey: ['jobs'] })

    expect(await within(toasts).findByText(text)).toBeInTheDocument()
  })

  it('shows the progress of a running pass in Activity', async () => {
    server.use(http.get('/jobs', ({ response }) => response(200).json({ items: [trashJob({ status: 'running', progress: { done: 12, total: 40 } })] })))
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    await userEvent.click(await screen.findByRole('tab', { name: /^Background Jobs/ }))

    expect(await screen.findByText('Re-scoring: 12 of 40 Titles')).toBeInTheDocument()
  })

  it('switches the daily check', async () => {
    const bodies: unknown[] = []
    server.use(
      http.patch('/settings', async ({ request, response }) => {
        bodies.push(await request.clone().json())
        return response(200).json({
          language_region: { primary_language: 'en', release_date_country: 'US' },
          root_folders: { movies: ['/m'], series: ['/s'] },
          check_github_updates: true,
          pause_grabs: false,
          display: displayDefaults,
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
          trash: { auto_update: false },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        })
      }),
    )
    renderForm()

    await userEvent.click(await screen.findByRole('checkbox', { name: /check trash daily/i }))

    expect(bodies).toEqual([{ trash: { auto_update: false } }])
  })
})

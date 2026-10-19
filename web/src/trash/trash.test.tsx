import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TrashForm } from './Trash'
import { http } from '../test/handlers'
import { server } from '../test/server'

const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrashForm />
    </QueryClientProvider>,
  )

describe('Update from TRaSH', () => {
  it('reports a rejected update and keeps the old snapshot', async () => {
    server.use(
      http.post('/trash/update', ({ response }) =>
        response('default').json({ type: 'about:blank', title: 'validation', status: 422, code: 'validation', detail: 'rejected' }, { status: 422 }),
      ),
    )
    renderForm()

    await userEvent.click(await screen.findByRole('button', { name: 'Update from TRaSH' }))

    expect(await screen.findByText(/previous one stays in use/i)).toBeInTheDocument()
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
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false },
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

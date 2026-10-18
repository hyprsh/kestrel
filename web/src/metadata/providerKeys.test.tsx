import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProviderKeysForm } from './ProviderKeys'
import { http } from '../test/handlers'
import { server } from '../test/server'

const settings = (tmdbSet: boolean) => ({
  language_region: { primary_language: 'en' as const, release_date_country: 'US' },
  kids_rule: { enabled: true, threshold: 6 as const },
  root_folders: { movies: ['/m'], series: ['/s'] },
  check_github_updates: true,
  trash: { auto_update: true },
  metadata: { tmdb_api_key_set: tmdbSet, tvdb_api_key_set: false },
})

const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProviderKeysForm />
    </QueryClientProvider>,
  )

describe('Provider keys', () => {
  it('saves a typed key and sends nothing for the one left empty', async () => {
    const bodies: unknown[] = []
    let saved = false
    server.use(
      http.get('/settings', ({ response }) => response(200).json(settings(saved))),
      http.patch('/settings', async ({ request, response }) => {
        bodies.push(await request.clone().json())
        saved = true
        return response(200).json(settings(true))
      }),
    )
    renderForm()

    await userEvent.type(await screen.findByLabelText('TMDB API key'), ' my-key ')
    await userEvent.click(screen.getByRole('button', { name: 'Save keys' }))

    await screen.findByRole('button', { name: 'Remove TMDB override' })
    expect(bodies).toEqual([{ metadata: { tmdb_api_key: 'my-key' } }])
  })

  it('removes an override by sending an empty key', async () => {
    const bodies: unknown[] = []
    server.use(
      http.get('/settings', ({ response }) => response(200).json(settings(true))),
      http.patch('/settings', async ({ request, response }) => {
        bodies.push(await request.clone().json())
        return response(200).json(settings(false))
      }),
    )
    renderForm()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove TMDB override' }))

    expect(bodies).toEqual([{ metadata: { tmdb_api_key: '' } }])
  })
})

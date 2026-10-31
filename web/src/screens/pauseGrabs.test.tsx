import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Settings = components['schemas']['Settings']

const settings = (pause: boolean): Settings => ({
  language_region: { primary_language: 'en', release_date_country: 'US' },
  root_folders: { movies: ['/m'], series: ['/s'] },
  check_github_updates: true,
  pause_grabs: pause,
  display: displayDefaults,
  from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
  trash: { auto_update: true },
  metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
})

describe('Pause Grabs', () => {
  it('is a switch in Settings saved like the other sections', async () => {
    let paused = false
    const bodies: unknown[] = []
    server.use(
      http.get('/settings', ({ response }) => response(200).json(settings(paused))),
      http.patch('/settings', async ({ request, response }) => {
        const body = await request.json()
        bodies.push(body)
        paused = body.pause_grabs ?? paused
        return response(200).json(settings(paused))
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const section = await screen.findByRole('region', { name: 'Grabs' })
    const toggle = await within(section).findByRole('checkbox', { name: /pause grabs/i })
    expect(toggle).not.toBeChecked()

    await userEvent.click(toggle)

    await waitFor(() => expect(bodies).toEqual([{ pause_grabs: true }]))
    await waitFor(() => expect(within(section).getByRole('checkbox', { name: /pause grabs/i })).toBeChecked())
  })
})

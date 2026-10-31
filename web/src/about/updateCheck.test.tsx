import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { displayDefaults, noDisplayDeclared } from '../test/display'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast, toastRegion } from '../test/toasts'

async function openSwitch() {
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return screen.findByRole('checkbox', { name: 'Check GitHub for updates' })
}

describe('the update-check switch', () => {
  it('says in a Toast why it could not save, and is not silent', async () => {
    server.use(http.patch('/settings', ({ response }) => response('default').json({ type: 'about:blank', title: 'x', status: 500, code: 'internal', detail: 'disk full' }, { status: 500 })))
    await userEvent.click(await openSwitch())

    expect(await findToast('Could not save the update check: disk full')).toBeInTheDocument()
  })

  it('shows its effect in place, so a save is not a Toast', async () => {
    let saved = 0
    server.use(
      http.patch('/settings', ({ response }) => {
        saved++
        return response(200).json({
          language_region: { primary_language: 'en', release_date_country: 'US' },
          root_folders: { movies: ['/m'], series: ['/s'] },
          check_github_updates: false,
          pause_grabs: false,
          display: displayDefaults,
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
          trash: { auto_update: true },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        })
      }),
    )
    await userEvent.click(await openSwitch())

    await expect.poll(() => saved).toBe(1)
    expect(within(await toastRegion()).queryByRole('listitem')).not.toBeInTheDocument()
  })
})

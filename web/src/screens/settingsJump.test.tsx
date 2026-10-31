import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Settings = components['schemas']['Settings']

const settings: Settings = {
  language_region: { primary_language: 'en', release_date_country: 'US' },
  root_folders: { movies: ['/m'], series: ['/s'] },
  check_github_updates: true,
  pause_grabs: false,
  display: displayDefaults,
  from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
  trash: { auto_update: true },
  metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
}

describe('Settings jump list', () => {
  const scrollIntoView = Element.prototype.scrollIntoView
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    server.use(http.get('/settings', ({ response }) => response(200).json(settings)))
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('keeps Settings open and focuses the section when a section link is clicked', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })
    await userEvent.click(within(jump).getByRole('link', { name: 'TRaSH' }))

    expect(location.pathname).toBe('/settings')
    expect(location.hash).toBe('#settings-trash')
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'TRaSH' })).toHaveFocus()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('has Plex and Reverse proxy links that jump to their own sections', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })

    await userEvent.click(within(jump).getByRole('link', { name: 'Plex' }))
    expect(location.hash).toBe('#settings-plex')
    expect(screen.getByRole('heading', { name: 'Plex', level: 2 })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Plex sign-in' })).toBeInTheDocument()

    await userEvent.click(within(jump).getByRole('link', { name: 'Reverse proxy' }))
    expect(location.hash).toBe('#settings-reverse-proxy')
    expect(screen.getByRole('heading', { name: 'Reverse proxy', level: 2 })).toHaveFocus()
  })
})

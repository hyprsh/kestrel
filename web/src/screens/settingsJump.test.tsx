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

  it('keeps Settings open and focuses the page when a page link is clicked', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })
    await userEvent.click(within(jump).getByRole('link', { name: 'Slots & Profiles' }))

    expect(location.pathname).toBe('/settings')
    expect(location.hash).toBe('#settings-slots-profiles')
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Slots & Profiles', level: 2 })).toHaveFocus()
    expect(screen.getByRole('region', { name: 'TRaSH' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Display' })).not.toBeInTheDocument()
  })

  it('has Security & Access and Media servers pages holding their old sections', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })

    await userEvent.click(within(jump).getByRole('link', { name: 'Security & Access' }))
    expect(location.hash).toBe('#settings-access')
    expect(screen.getByRole('heading', { name: 'Security & Access', level: 2 })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Plex sign-in' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Reverse proxy' })).toBeInTheDocument()

    await userEvent.click(within(jump).getByRole('link', { name: 'Media servers' }))
    expect(screen.getByRole('region', { name: 'Silo' })).toBeInTheDocument()
  })

  it('opens an old section id from the address on the page that holds it, and scrolls to it', async () => {
    history.replaceState(null, '', '/settings#settings-reverse-proxy')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Security & Access', level: 2 })).toBeInTheDocument()
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    history.replaceState(null, '', '/')
  })

  it('opens the first page, groups the list and finds a setting by its row or sub-section', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(jump).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'true')
    expect(within(jump).getByRole('list', { name: 'Connections' })).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a setting' }), 'api key{Enter}')
    expect(location.hash).toBe('#settings-security')
    expect(await screen.findByRole('heading', { name: 'API key' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Find a setting' })).toHaveValue('')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a setting' }), 'indexers')
    expect(within(jump).getByRole('link', { name: /Downloads/ })).toHaveTextContent('Indexers')
  })
  it.each(['/settings/slots-profiles', '/settings/profiles', '/settings/slots', '/settings/library#settings-slots'])('opens Slots & Profiles from the old address %s', async (address) => {
    history.replaceState(null, '', address)
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Slots & Profiles', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Slots' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Profiles' })).toBeInTheDocument()
    history.replaceState(null, '', '/')
  })

  it('keeps Root folders, Existing files and Provider keys in Library, and finds the Slot settings in Slots & Profiles', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const jump = await screen.findByRole('navigation', { name: 'Settings sections' })
    await userEvent.click(within(jump).getByRole('link', { name: 'Library' }))
    expect(screen.getByRole('region', { name: 'Root folders' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Provider keys' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Slots' })).not.toBeInTheDocument()

    for (const text of ['Slot label', 'Add Slot', 'Defaults per Slot']) {
      await userEvent.clear(screen.getByRole('searchbox', { name: 'Find a setting' }))
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find a setting' }), text)
      expect(within(jump).getByRole('link', { name: /Slots & Profiles/ })).toBeInTheDocument()
    }
  })
})

import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type About = components['schemas']['About']

const about = (over: Partial<About> = {}): About => ({
  version: '0.2.0',
  license: 'GPL-3.0-only',
  trash_commit: '14a4166673996301e588a4f70d03b9cfb760b50f',
  check_github_updates: true,
  update: null,
  checked_at: null,
  ...over,
})

describe('About', () => {
  it('shows the version, licence, TRaSH commit, attribution, shortcuts and the update', async () => {
    server.use(
      http.get('/about', ({ response }) =>
        response(200).json(
          about({
            update: {
              version: '0.3.0',
              url: 'https://github.com/hyprsh/kestrel/releases/tag/v0.3.0',
            },
          }),
        ),
      ),
      http.get('/about/notices', () => HttpResponse.text('# Third-party notices\n\nRadarr and Sonarr')),
    )
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'About' }))

    const kestrel = await screen.findByRole('region', { name: 'Kestrel' })
    expect(await within(kestrel).findByText('0.2.0')).toBeInTheDocument()
    expect(within(kestrel).queryByRole('status')).not.toBeInTheDocument()
    expect(kestrel).toHaveTextContent('GPL-3.0-only')
    expect(kestrel).toHaveTextContent('14a4166')
    expect(within(kestrel).getByRole('link', { name: 'Kestrel 0.3.0 available' })).toHaveAttribute('href', 'https://github.com/hyprsh/kestrel/releases/tag/v0.3.0')
    expect(within(kestrel).getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://hyprsh.github.io/kestrel/')
    const attribution = screen.getByRole('region', { name: 'Attribution' })
    expect(attribution).toHaveTextContent('This product uses the TMDB API but is not endorsed or certified by TMDB.')
    expect(attribution).toHaveTextContent('Metadata provided by TheTVDB.')
    expect(within(attribution).getByRole('img', { name: 'TMDB' })).toBeInTheDocument()
    expect(within(attribution).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org')
    const shortcuts = screen.getByRole('region', {
      name: 'Keyboard shortcuts',
    })
    expect(
      within(shortcuts)
        .getAllByRole('definition')
        .map((d) => d.textContent),
    ).toContain('Open the command menu: jump to a Title or screen, add a Title, run an action')
    expect(within(shortcuts).getAllByRole('term')).toHaveLength(5)

    await userEvent.click(screen.getByRole('button', { name: 'Show notices' }))
    expect(await screen.findByLabelText('Notices text')).toHaveTextContent('Radarr and Sonarr')
  })

  it('says the check is off when the switch is off', async () => {
    server.use(http.get('/about', ({ response }) => response(200).json(about({ check_github_updates: false }))))
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'About' }))

    expect(await screen.findByText(/the check is off/i)).toBeInTheDocument()
  })
})

describe('About while loading', () => {
  it('shows a Skeleton in the shape of the version, announced once, until it loads', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.get('/about', async ({ response }) => {
        await held
        return response(200).json(about())
      }),
    )
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'About' }))
    const kestrel = await screen.findByRole('region', { name: 'Kestrel' })
    expect(within(kestrel).getByRole('status')).toHaveTextContent('Loading the version')
    expect(within(kestrel).getByText('Licence')).toBeInTheDocument()
    expect(within(kestrel).queryByText('0.2.0')).not.toBeInTheDocument()

    await act(async () => release())
    expect(await within(kestrel).findByText('0.2.0')).toBeInTheDocument()
    expect(within(kestrel).queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('the health strip', () => {
  it('lists an available update', async () => {
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json({
          download_client: {
            state: 'none',
            name: null,
            instance_id: null,
            message: null,
          },
          indexers: [],
          disks: [],
          trash: {
            commit: 'abc1234',
            committed_at: null,
            checked_at: null,
            auto_update: true,
          },
          grabs_paused: false,
          update: { version: '0.3.0', url: 'https://example.test/r' },
        }),
      ),
    )
    renderApp()

    // Health shows its summary line alone while every check is ok: open it, then find its panel.
    const toggle = await screen.findByRole('button', { name: /^Health ·/ })
    if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle)
    const strip = await screen.findByRole('region', { name: /^Health/ })
    expect(await within(strip).findByText('Kestrel 0.3.0 available')).toBeInTheDocument()
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { PlexSignInSettings } from '../api/plex'
import { http } from '../test/handlers'
import { plexInstance, problem } from '../test/plex'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Saved = PlexSignInSettings & { from_config_file: boolean }

/** A Security section with two Plex instances (and a Jellyfin one that must not be offered), two Movie Root folders and the given Plex sign-in. */
function fakePlexSettings(initial: Partial<Saved> = {}, rejects?: { field: string; message: string }[]) {
  let saved: Saved = { enabled: false, instance: null, users: [], user_root_folders: [], from_config_file: false, ...initial }
  const sent: PlexSignInSettings[] = []
  server.use(
    http.get('/plugin-instances', ({ response }) =>
      response(200).json({
        items: [plexInstance('Living room Plex', 3), plexInstance('Jelly', 4), plexInstance('Garage Plex', 5)].map((i) => (i.name === 'Jelly' ? { ...i, plugin_id: 'jellyfin' } : i)),
        next_cursor: null,
      }),
    ),
    http.get('/settings', ({ response }) =>
      response(200).json({
        language_region: { primary_language: 'en', release_date_country: 'US' },
        check_github_updates: true,
        pause_grabs: false,
        from_config_file: { language_region: false, root_folders: false, check_github_updates: false },
        trash: { auto_update: true },
        metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        root_folders: { movies: ['/data/movies', '/data/kids-movies'], series: ['/data/tv'] },
      }),
    ),
    http.get('/settings/plex-sign-in', ({ response }) => response(200).json(saved)),
    http.put('/settings/plex-sign-in', async ({ request, response }) => {
      if (rejects) return response(422).json({ ...problem(422, 'validation'), errors: rejects.map((r) => ({ ...r, code: 'invalid' })) })
      const body = (await request.json()) as PlexSignInSettings
      sent.push(body)
      saved = { ...body, from_config_file: false }
      return response(200).json(saved)
    }),
  )
  return sent
}

const openCard = async () => {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Security' })
  return screen.findByRole('heading', { name: 'Plex sign-in' })
}

describe('Settings > Security > Plex sign-in', () => {
  it('saves the switch, the Plex instance, the users and a user’s Root folders', async () => {
    const sent = fakePlexSettings()
    await openCard()

    const instance = await screen.findByRole('combobox', { name: 'Plex instance' })
    expect(
      within(instance)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a Plex instance', 'Living room Plex', 'Garage Plex']) // Plex instances only
    await userEvent.click(screen.getByRole('switch', { name: 'Let people sign in with Plex' }))
    await userEvent.selectOptions(instance, 'Garage Plex')
    await userEvent.type(screen.getByRole('textbox', { name: 'Users' }), 'anna{Enter}Ben Kids{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const row = screen.getByRole('group', { name: 'Root folders for user 1' })
    await userEvent.type(within(row).getByRole('textbox', { name: 'User' }), 'Ben Kids')
    expect(
      within(within(row).getByRole('combobox', { name: 'Movie Root folder' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['First Root folder', '/data/movies', '/data/kids-movies'])
    await userEvent.selectOptions(within(row).getByRole('combobox', { name: 'Movie Root folder' }), '/data/kids-movies')
    await userEvent.click(screen.getByRole('button', { name: 'Save Plex sign-in' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(sent).toEqual([{ enabled: true, instance: 'Garage Plex', users: ['anna', 'Ben Kids'], user_root_folders: [{ user: 'Ben Kids', movies: '/data/kids-movies', series: null }] }])
  })

  it('shows what is saved and removes a user’s Root folders', async () => {
    const sent = fakePlexSettings({
      enabled: true,
      instance: 'Living room Plex',
      users: ['anna'],
      user_root_folders: [{ user: 'anna', movies: '/data/kids-movies', series: '/data/tv' }],
    })
    await openCard()

    expect(await screen.findByRole('switch', { name: 'Let people sign in with Plex' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Plex instance' })).toHaveValue('Living room Plex')
    expect(screen.getByRole('textbox', { name: 'Users' })).toHaveValue('anna')
    expect(screen.getByRole('combobox', { name: 'Movie Root folder' })).toHaveValue('/data/kids-movies')
    await userEvent.click(screen.getByRole('button', { name: 'Remove user' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Plex sign-in' }))
    await screen.findByText('Saved.')
    expect(sent[0].user_root_folders).toEqual([])
  })

  it('shows the server’s field errors', async () => {
    fakePlexSettings({}, [
      { field: 'instance', message: 'Choose a Plex instance to turn this on' },
      { field: 'user_root_folders[0].movies', message: '/nope is not a Movie Root folder' },
    ])
    await openCard()

    await userEvent.click(await screen.findByRole('switch', { name: 'Let people sign in with Plex' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'User' }), 'anna')
    await userEvent.click(screen.getByRole('button', { name: 'Save Plex sign-in' }))

    expect(await screen.findByText('Choose a Plex instance to turn this on')).toBeInTheDocument()
    expect(screen.getByText('/nope is not a Movie Root folder')).toBeInTheDocument()
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
  })

  it('is read-only, with the declared note, while the Config File declares it', async () => {
    fakePlexSettings({ enabled: true, instance: 'Living room Plex', users: ['anna'], from_config_file: true })
    await openCard()

    expect(await screen.findByRole('switch', { name: 'Let people sign in with Plex' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Plex instance' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Users' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Plex sign-in' })).toBeDisabled()
    expect(screen.getByText(/Config File sets Plex sign-in/)).toBeInTheDocument()
  })
})

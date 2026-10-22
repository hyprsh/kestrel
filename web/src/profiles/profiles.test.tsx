import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { fakeSetup } from '../test/fakeSetup'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
const problem = (status: number, code: string, detail: string) => ({ type: 'about:blank', title: 'x', status, code, detail })

type Profile = components['schemas']['Profile']
type Settings = components['schemas']['Settings']
type Sent = { path: string; body: unknown }

const profile = (key: string, name: string, slot: Profile['slot'], rule: Profile['language_rule'], over: Partial<Profile> = {}): Profile => ({
  key,
  name,
  slot,
  language_rule: rule,
  original_language: 'reject',
  original_fallback: false,
  from_config_file: false,
  enabled: true,
  default_movies: false,
  default_series: false,
  min_height: 0,
  max_height: 1080,
  trash_profile_movies: 'hd-bluray-web',
  trash_profile_series: 'web-1080p',
  ...over,
})

const seeded = (): Profile[] => [
  profile('hd-primary', 'HD', 'standard', 'primary', { default_movies: true, default_series: true }),
  profile('hd-original', 'HD Original', 'standard', 'original'),
  profile('any-primary', 'Any', 'standard', 'primary'),
  profile('any-original', 'Any Original', 'standard', 'original'),
  profile('4k-primary', '4K', '4k', 'primary'),
  profile('4k-original', '4K Original', '4k', 'original'),
]

/** The Profile and settings API with real behaviour for the rules the UI leans on. */
function fakeProfiles(opts: { fresh?: boolean } = {}) {
  const sent: Sent[] = []
  let signedIn = !opts.fresh
  let profiles = seeded()
  let settings: Settings = {
    language_region: { primary_language: 'en', release_date_country: 'US' },
    check_github_updates: true,
    pause_grabs: false,
    from_config_file: { language_region: false, root_folders: false, check_github_updates: false },
    trash: { auto_update: true },
    metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
  }
  if (opts.fresh) fakeSetup()
  server.use(
    http.get('/auth/me', ({ response }) =>
      signedIn ? response(200).json(me) : response('default').json({ ...problem(401, 'setup_required', 'x') }, { status: 401 }),
    ),
    http.post('/setup/account', ({ response }) => {
      signedIn = true
      return response(201).json(me)
    }),
    http.get('/settings', ({ response }) => response(200).json(settings)),
    http.patch('/settings', async ({ request, response }) => {
      const body = (await request.json()) as { language_region?: Partial<Settings['language_region']> }
      sent.push({ path: 'settings', body })
      settings = {
        ...settings,
        language_region: { ...settings.language_region, ...body.language_region },
      } as Settings
      return response(200).json(settings)
    }),
    http.get('/profiles', ({ response }) => response(200).json({ items: profiles })),
    http.patch('/profiles/{key}', async ({ request, params, response }) => {
      const body = (await request.json()) as Partial<Profile>
      sent.push({ path: `profile ${params.key}`, body })
      const cur = profiles.find((p) => p.key === params.key)!
      if (cur.slot === 'standard' && cur.enabled && (body.enabled === false || body.default_movies === false)) {
        return response('default').json(problem(422, 'validation', 'The Standard Slot always has a default: make another Standard Profile the default first'), { status: 422 })
      }
      profiles = profiles.map((p) => {
        if (p.slot === cur.slot && body.default_movies) p = { ...p, default_movies: false }
        if (p.slot === cur.slot && body.default_series) p = { ...p, default_series: false }
        return p.key === cur.key ? { ...p, ...body } : p
      })
      return response(200).json(profiles.find((p) => p.key === cur.key)!)
    }),
  )
  return sent
}

const createAccount = async () => {
  await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
  await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('the wizard Primary Language section', () => {
  it('explains the choice, prefills the country from the language and saves both', async () => {
    const sent = fakeProfiles({ fresh: true })
    renderApp()
    await createAccount()

    const section = await screen.findByRole('region', { name: 'Primary Language' })
    expect(await within(section).findByText(/required audio/i)).toBeInTheDocument() // the explainer
    const language = within(section).getByLabelText('Primary Language')
    expect(language).toHaveValue('en')
    expect(within(section).getByLabelText('Release-date country')).toHaveValue('US')

    await userEvent.selectOptions(language, 'de')
    expect(within(section).getByLabelText('Release-date country')).toHaveValue('DE')
    await userEvent.selectOptions(language, 'fr')
    expect(within(section).getByLabelText('Release-date country')).toHaveValue('FR')

    // The country stays editable.
    await userEvent.clear(within(section).getByLabelText('Release-date country'))
    await userEvent.type(within(section).getByLabelText('Release-date country'), 'be')
    await userEvent.click(within(section).getByRole('button', { name: 'Save language' }))

    expect(await within(section).findByText('Saved.')).toBeInTheDocument()
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'settings', body: { language_region: { primary_language: 'fr', release_date_country: 'BE' } } }))
  })
})

describe('the wizard Profiles section', () => {
  it('sets a default per Slot for Movies and for Series ', async () => {
    const sent = fakeProfiles({ fresh: true })
    renderApp()
    await createAccount()

    const section = await screen.findByRole('region', { name: 'Profiles' })
    // Standard is preselected for both kinds and has no empty choice; 4K starts empty.
    const hdMovies = await within(section).findByLabelText('Standard default for Movies')
    expect(hdMovies).toHaveValue('hd-primary')
    expect(within(hdMovies).queryByRole('option', { name: 'None' })).not.toBeInTheDocument()
    expect(within(section).getByLabelText('4K default for Movies')).toHaveValue('')

    await userEvent.selectOptions(within(section).getByLabelText('4K default for Movies'), '4k-primary')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile 4k-primary', body: { default_movies: true } }))
    expect(await within(section).findByLabelText('4K default for Movies')).toHaveValue('4k-primary')
    expect(within(section).getByLabelText('4K default for Series')).toHaveValue('')

    await userEvent.selectOptions(within(section).getByLabelText('Standard default for Series'), 'hd-original')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile hd-original', body: { default_series: true } }))

    // Unsetting a default is "None" for 4K.
    await userEvent.selectOptions(within(section).getByLabelText('4K default for Movies'), '')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile 4k-primary', body: { default_movies: false } }))
  })

  it('shows why a default cannot be unset', async () => {
    fakeProfiles({ fresh: true })
    renderApp()
    await createAccount()
    const section = await screen.findByRole('region', { name: 'Profiles' })
    // The server refuses to leave HD without a default; the message reaches the admin.
    server.use(
      http.patch('/profiles/{key}', ({ response }) =>
        response('default').json(problem(422, 'validation', 'HD always has a default for movies'), { status: 422 }),
      ),
    )
    await userEvent.selectOptions(await within(section).findByLabelText('Standard default for Movies'), 'hd-original')
    expect(await within(section).findByRole('alert')).toHaveTextContent('HD always has a default for movies')
  })
})

describe('Settings', () => {
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  }

  it('lists the Primary Language and Profiles sections in the jump list', async () => {
    fakeProfiles()
    await open()
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Primary Language' })).toHaveAttribute('href', '/settings#settings-language')
    expect(within(nav).getByRole('link', { name: 'Profiles' })).toHaveAttribute('href', '/settings#settings-profiles')
    expect(await within(await screen.findByRole('region', { name: 'Primary Language' })).findByLabelText('Primary Language')).toHaveValue('en')
  })

  it('enables, disables and chooses what each Primary-Language Profile does with Original-only Releases', async () => {
    const sent = fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Profiles' })

    await userEvent.click(await within(section).findByLabelText('4K enabled'))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile 4k-primary', body: { enabled: false } }))
    // A disabled Profile cannot be a default, so it leaves the choices.
    await waitFor(() =>
      expect(within(within(section).getByLabelText('4K default for Movies')).queryByRole('option', { name: '4K' })).not.toBeInTheDocument(),
    )

    // Original-Language Profiles have no choice; Primary-Language ones reject, offer or grab.
    expect(within(section).queryByLabelText('HD Original Original Language only')).not.toBeInTheDocument()
    const choice = within(section).getByLabelText('HD Original Language only')
    expect(choice).toHaveValue('reject')
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Reject', 'Offer for approval', 'Grab'])
    await userEvent.selectOptions(choice, 'offer')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile hd-primary', body: { original_language: 'offer' } }))
  })

  it('shows the server problem when the only HD default is disabled', async () => {
    fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Profiles' })
    await userEvent.click(await within(section).findByLabelText('HD enabled'))
    expect(await within(section).findByRole('alert')).toHaveTextContent('The Standard Slot always has a default')
  })

  it('saves a new Primary Language and says what it changes', async () => {
    const sent = fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Primary Language' })
    await userEvent.selectOptions(await within(section).findByLabelText('Primary Language'), 'de')
    expect(within(section).getByText(/re-scores every file you already have/i)).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Save language' }))
    expect(await within(section).findByText('Saved.')).toBeInTheDocument()
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'settings', body: { language_region: { primary_language: 'de', release_date_country: 'DE' } } }))
  })
})

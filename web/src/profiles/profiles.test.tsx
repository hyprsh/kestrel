import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast } from '../test/toasts'
import { fakeSetup } from '../test/fakeSetup'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
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
    display: displayDefaults,
    from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
    trash: { auto_update: true },
    metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
  }
  if (opts.fresh) fakeSetup()
  server.use(
    http.get('/auth/me', ({ response }) => (signedIn ? response(200).json(me) : response('default').json({ ...problem(401, 'setup_required', 'x') }, { status: 401 }))),
    http.post('/setup/account', ({ response }) => {
      signedIn = true
      return response(201).json(me)
    }),
    http.get('/settings', ({ response }) => response(200).json(settings)),
    http.patch('/settings', async ({ request, response }) => {
      const body = (await request.json()) as { language_region?: Partial<Settings['language_region']> }
      sent.push({ path: 'settings', body })
      // A new Primary Language waits for its re-score: Settings keeps the old one and reports the pending one.
      const next = body.language_region?.primary_language
      const pending = next && next !== settings.language_region.primary_language ? next : undefined
      settings = {
        ...settings,
        language_region: {
          ...settings.language_region,
          ...body.language_region,
          ...(pending ? { primary_language: settings.language_region.primary_language, pending_primary_language: pending } : {}),
        },
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

    expect(await findToast('Re-scoring under French in the background')).toBeInTheDocument()
    expect(within(section).queryByText('Saved.')).not.toBeInTheDocument()
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
    server.use(http.patch('/profiles/{key}', ({ response }) => response('default').json(problem(422, 'validation', 'HD always has a default for movies'), { status: 422 })))
    await userEvent.selectOptions(await within(section).findByLabelText('Standard default for Movies'), 'hd-original')
    expect(await within(section).findByRole('alert')).toHaveTextContent('HD always has a default for movies')
  })
})

describe('Settings', () => {
  // Settings shows one section at a time, the first until another is chosen in the panel.
  const open = async (section?: string) => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    if (section) await userEvent.click(await screen.findByRole('link', { name: section }))
  }
  const bar = () => screen.getByRole('region', { name: 'Unsaved changes' })

  const scoring = (qualities: string[], min: number) => ({
    qualities,
    min_score: min,
    custom_formats: [
      { name: 'WEB Tier 01', score: 1700 },
      { name: 'HDR', score: 500 },
      { name: 'x265 (HD)', score: -150 },
      { name: 'Repack', score: 5 },
    ],
  })
  const serveDetails = () =>
    server.use(
      http.get('/profiles/details', ({ response }) =>
        response(200).json({
          items: seeded().map((p) => ({
            key: p.key,
            titles: p.key === 'hd-primary' ? 6 : 0,
            files: p.key === 'hd-primary' ? 61 : 0,
            movies: scoring(['Bluray-1080p', 'WEBDL-1080p', 'Remux-1080p', 'HDTV-720p'], 0),
            series: scoring(['WEBDL-1080p', 'Bluray-1080p', 'Remux-1080p', 'HDTV-720p'], 0),
          })),
        }),
      ),
    )

  it('lists the General and Profiles pages in the jump list', async () => {
    fakeProfiles()
    await open()
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/settings#settings-general')
    expect(within(nav).getByRole('link', { name: 'Profiles' })).toHaveAttribute('href', '/settings#settings-profiles')
    expect(await within(await screen.findByRole('region', { name: 'Language' })).findByLabelText('Primary language')).toHaveValue('en')
  })

  it('keeps a Language change as a draft, saves it from the bar and shows it as switching until its re-score ends', async () => {
    const sent = fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Language' })
    await userEvent.selectOptions(await within(section).findByLabelText('Primary language'), 'de')

    expect(within(section).getByLabelText('Release-date country')).toHaveValue('DE')
    expect(bar()).toHaveTextContent('2 unsaved changes · Primary language, Country')
    expect(sent).toEqual([]) // nothing is sent until Save
    await userEvent.click(within(bar()).getByRole('button', { name: 'Save' }))

    expect(await findToast('Re-scoring under German in the background')).toBeInTheDocument()
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'settings', body: { language_region: { primary_language: 'de', release_date_country: 'DE' } } }))
    expect(await within(section).findByText(/Switching to German…/)).toBeInTheDocument()
    expect(within(section).getByLabelText('Primary language')).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it('marks a changed row, and Discard puts every row back', async () => {
    fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Language' })
    await userEvent.selectOptions(await within(section).findByLabelText('Primary language'), 'fr')
    await userEvent.clear(within(section).getByLabelText('Release-date country'))
    await userEvent.type(within(section).getByLabelText('Release-date country'), 'be')
    expect(within(section).getByLabelText('Release-date country')).toHaveValue('BE')

    await userEvent.click(within(bar()).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(within(section).getByLabelText('Primary language')).toHaveValue('en')
    expect(within(section).getByLabelText('Release-date country')).toHaveValue('US')
  })

  it('asks before leaving the page with unsaved changes, and leaves once told to discard', async () => {
    fakeProfiles()
    await open()
    const section = await screen.findByRole('region', { name: 'Language' })
    await userEvent.selectOptions(await within(section).findByLabelText('Primary language'), 'fr')

    await userEvent.click(screen.getByRole('link', { name: 'Profiles' }))
    const ask = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    expect(ask).toHaveTextContent('Primary language, Country')
    expect(screen.queryByRole('heading', { name: 'Profiles', level: 2 })).not.toBeInTheDocument()

    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Primary language')).toHaveValue('fr')

    await userEvent.click(screen.getByRole('link', { name: 'Profiles' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Discard and leave' }))
    expect(await screen.findByRole('heading', { name: 'Profiles', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it('leaves without asking when nothing changed', async () => {
    fakeProfiles()
    await open('Profiles')
    expect(await screen.findByRole('heading', { name: 'Profiles', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument()
  })

  it('keeps the draft and says why when the save fails', async () => {
    fakeProfiles()
    server.use(http.patch('/settings', ({ response }) => response('default').json(problem(500, 'internal', 'database locked'), { status: 500 })))
    await open()
    const section = await screen.findByRole('region', { name: 'Language' })
    await userEvent.selectOptions(await within(section).findByLabelText('Primary language'), 'de')
    await userEvent.click(within(bar()).getByRole('button', { name: 'Save' }))

    expect(await within(section).findByText('Could not save. Try again.')).toBeInTheDocument()
    expect(await findToast('Could not save Primary language, Country')).toBeInTheDocument()
    expect(bar()).toBeInTheDocument()
  })

  it('shows each Profile as a card with its qualities best first and what uses it', async () => {
    fakeProfiles()
    serveDetails()
    await open('Profiles')
    const hd = await screen.findByRole('region', { name: 'HD' })
    expect(await within(hd).findByText('Standard · 6 Titles')).toBeInTheDocument()
    expect(within(hd).getByText('Remux-1080p').compareDocumentPosition(within(hd).getByText('HDTV-720p')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(hd).getByText('Default for Movies and Series')).toBeInTheDocument()
    expect(within(await screen.findByRole('region', { name: 'New Titles get' })).getByText('HD')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Change…' }))
    expect(await screen.findByLabelText('4K default for Movies')).toBeInTheDocument()
  })

  it('edits a Profile in a side sheet: what it does with Original-only Releases, saved with the sheet’s own Save', async () => {
    const sent = fakeProfiles()
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })

    expect(await within(sheet).findByText('61 files in 6 Titles use this Profile')).toBeInTheDocument()
    expect(
      within(sheet)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Remux-1080p', 'Bluray-1080p', 'WEBDL-1080p', 'HDTV-720p'])
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    const choice = within(sheet).getByLabelText('Original Language only')
    expect(
      within(choice)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Reject', 'Offer for approval', 'Grab'])
    await userEvent.selectOptions(choice, 'offer')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile hd-primary', body: { original_language: 'offer' } }))
    expect(await findToast('Saved HD')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'HD' })).not.toBeInTheDocument())
  })

  it('summarises the Custom Formats in the sheet and lists them all on request, and Cancel closes it unsaved', async () => {
    const sent = fakeProfiles()
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    expect(await within(sheet).findByText(/From TRaSH · 4 scored · WEB Tier 01 \+1700 · HDR \+500 · x265 \(HD\) −150 …/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show all' }))
    expect(within(sheet).getByText(/Repack \+5/)).toBeInTheDocument()

    await userEvent.click(within(sheet).getByLabelText('Enabled'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'HD' })).not.toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('shows the server problem in the sheet when the only HD default is disabled', async () => {
    fakeProfiles()
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    await userEvent.click(within(sheet).getByLabelText('Enabled'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('The Standard Slot always has a default')
  })

  it('shows the sheet read-only, and says why, while the Config File sets the Profiles', async () => {
    fakeProfiles()
    serveDetails()
    server.use(http.get('/profiles', ({ response }) => response(200).json({ items: seeded().map((p) => ({ ...p, from_config_file: true })) })))
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    expect(within(sheet).getByText(/Config File sets the Profiles, so nothing here can be changed/)).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Enabled')).toBeDisabled()
    expect(within(sheet).getByLabelText('Original Language only')).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

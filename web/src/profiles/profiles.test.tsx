import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast } from '../test/toasts'
import { fakeSetup } from '../test/fakeSetup'
import { seededSlots } from '../test/slots'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
const problem = (status: number, code: string, detail: string) => ({ type: 'about:blank', title: 'x', status, code, detail })

type Profile = components['schemas']['Profile']
type Settings = components['schemas']['Settings']
type Sent = { path: string; body: unknown }
type Details = components['schemas']['ProfileDetail']
type Slot = components['schemas']['Slot']
type Suggestion = components['schemas']['ProfileSuggestion']
type SuggestionGroup = components['schemas']['ProfileSuggestionGroup']

const profile = (key: string, name: string, rule: Profile['language_rule'], over: Partial<Profile> = {}): Profile => ({
  key,
  name,
  release_family: 'bluray-web',
  resolution: 'hd',
  kinds: ['movie', 'series'],
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
  profile('hd-primary', 'HD', 'primary', { default_movies: true, default_series: true }),
  profile('hd-original', 'HD Original', 'original'),
  profile('any-primary', 'Any', 'primary'),
  profile('any-original', 'Any Original', 'original'),
  profile('4k-primary', '4K', 'primary'),
  profile('4k-original', '4K Original', 'original'),
]

/** The Profile and settings API with real behaviour for the rules the UI leans on. */
function fakeProfiles(opts: { fresh?: boolean; groups?: SuggestionGroup[]; warnings?: Settings['warnings']; primary?: Settings['language_region']['primary_language'] } = {}) {
  const sent: Sent[] = []
  let signedIn = !opts.fresh
  let profiles = seeded()
  let slots = seededSlots()
  let groups = opts.groups ?? []
  let settings: Settings = {
    language_region: { primary_language: opts.primary ?? 'en', release_date_country: 'US' },
    check_github_updates: true,
    pause_grabs: false,
    display: displayDefaults,
    from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
    trash: { auto_update: true },
    metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
    ...(opts.warnings ? { warnings: opts.warnings } : {}),
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
    http.get('/profiles/suggestions', ({ response }) => response(200).json({ groups })),
    http.post('/profiles', async ({ request, response }) => {
      const body = (await request.json()) as Partial<Suggestion>
      sent.push({ path: 'import', body })
      const hit = groups.flatMap((g) => g.items).find((i) => i.release_family === body.release_family && i.resolution === body.resolution && i.language_rule === body.language_rule)!
      const made = profile(`made-${profiles.length}`, hit.name, hit.language_rule, { release_family: hit.release_family, kinds: hit.kinds, custom: true })
      profiles = [...profiles, made]
      groups = groups.map((g) => ({ ...g, items: g.items.filter((i) => i !== hit) })).filter((g) => g.items.length > 0)
      return response(201).json(made)
    }),
    http.get('/slots', ({ response }) => response(200).json({ items: slots })),
    http.patch('/slots/{id}', async ({ request, params, response }) => {
      const body = (await request.json()) as Partial<Slot>
      sent.push({ path: `slot ${params.id}`, body })
      slots = slots.map((s) =>
        s.id === params.id
          ? {
              ...s,
              ...body,
              default_movies: body.default_movies === undefined ? s.default_movies : body.default_movies || null,
              default_series: body.default_series === undefined ? s.default_series : body.default_series || null,
            }
          : s,
      )
      return response(200).json(slots.find((s) => s.id === params.id)!)
    }),
    http.patch('/profiles/{key}', async ({ request, params, response }) => {
      const body = (await request.json()) as Partial<Profile>
      sent.push({ path: `profile ${params.key}`, body })
      const cur = profiles.find((p) => p.key === params.key)!
      profiles = profiles.map((p) => (p.key === cur.key ? { ...p, ...body } : p))
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

describe('the default Profile per Slot in Settings', () => {
  const openDefaults = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Profiles' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }))
  }

  it('sets a default per Slot for Movies and for Series ', async () => {
    const sent = fakeProfiles()
    await openDefaults()

    // Each Slot shows its own default for both kinds, whatever the Profile is (no Profile belongs to a Slot).
    const hdMovies = await screen.findByLabelText('Standard default for Movies')
    expect(hdMovies).toHaveValue('hd-primary')
    expect(screen.getByLabelText('4K default for Movies')).toHaveValue('4k-primary')
    expect(within(screen.getByLabelText('4K default for Series')).getByRole('option', { name: 'HD Original' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Standard default for Series'), 'hd-original')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'slot standard', body: { default_series: 'hd-original' } }))
    expect(await screen.findByLabelText('Standard default for Series')).toHaveValue('hd-original')

    // A Slot can have none: "None" clears it.
    await userEvent.selectOptions(screen.getByLabelText('4K default for Movies'), '')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'slot 4k', body: { default_movies: '' } }))
  })

  it('shows why a default cannot be saved', async () => {
    fakeProfiles()
    await openDefaults()
    // The server refuses a default that is a disabled Profile; the message reaches the admin.
    server.use(http.patch('/slots/{id}', ({ response }) => response('default').json(problem(422, 'validation', 'HD is turned off'), { status: 422 })))
    await userEvent.selectOptions(await screen.findByLabelText('Standard default for Movies'), 'hd-original')
    expect(await screen.findByRole('alert')).toHaveTextContent('HD is turned off')
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

  type Quality = { name: string; accepted: boolean }
  const ladderOf = (names: string[], off: string[] = []): Quality[] => names.map((name) => ({ name, accepted: !off.includes(name) }))
  const emptyOverlay = (): Details['overlay'] => ({
    min_score: null,
    upgrade_until: null,
    series: { cutoff: null, qualities: null },
    movies: { cutoff: null, qualities: null },
    episode_size: { min: null, max: null },
    movie_size: { min: null, max: null },
  })
  const scoring = (names: string[], min: number, over: { off?: string[]; cutoff?: string | null; ladder?: Quality[] } = {}) => {
    const trash = ladderOf(names)
    const ladder = over.ladder ?? ladderOf(names, over.off)
    return {
      qualities: ladder.filter((q) => q.accepted).map((q) => q.name),
      ladder,
      trash_ladder: trash,
      cutoff: over.cutoff ?? null,
      min_score: min,
      trash_min_score: min,
      custom_formats: [
        { name: 'WEB Tier 01', score: 1700 },
        { name: 'HDR', score: 500 },
        { name: 'x265 (HD)', score: -150 },
        { name: 'Repack', score: 5 },
      ],
    }
  }
  const GB = 1024 ** 3
  const best = ['Remux-1080p', 'Bluray-1080p', 'WEBDL-1080p', 'WEBRip-1080p', 'HDTV-1080p']
  /** The HD Profile as the user set it up: WEB-DL 1080p is good enough, up to Score 2,000, 1 - 10 GB per episode, HDTV off. */
  const configuredHd = (): Details => ({
    key: 'hd-primary',
    titles: 6,
    files: 61,
    rescores: 61,
    below_cutoff: 12,
    overlay: {
      ...emptyOverlay(),
      upgrade_until: 2000,
      series: { cutoff: 'WEBDL-1080p', qualities: ladderOf(best, ['HDTV-1080p']) },
      episode_size: { min: GB, max: 10 * GB },
    },
    movies: scoring(['Remux-1080p', 'Bluray-1080p', 'WEBDL-1080p', 'HDTV-720p'], 0),
    series: scoring(best, 0, { off: ['HDTV-1080p'], cutoff: 'WEBDL-1080p' }),
  })
  const serveDetails = (over: Partial<Record<string, Details>> = {}) =>
    server.use(
      http.get('/profiles/details', ({ response }) =>
        response(200).json({
          items: [
            ...seeded(),
            ...Object.keys(over)
              .filter((k) => !seeded().some((p) => p.key === k))
              .map((k) => ({ key: k })),
          ].map(
            (p): Details =>
              over[p.key] ?? {
                key: p.key,
                titles: p.key === 'hd-primary' ? 6 : 0,
                files: p.key === 'hd-primary' ? 61 : 0,
                rescores: p.key === 'hd-primary' ? 61 : 0,
                below_cutoff: 0,
                overlay: emptyOverlay(),
                movies: scoring(['Remux-1080p', 'Bluray-1080p', 'WEBDL-1080p', 'HDTV-720p'], 0),
                series: scoring(['Remux-1080p', 'Bluray-1080p', 'WEBDL-1080p', 'HDTV-720p'], 0),
              },
          ),
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

  it('shows each Profile as a card with its ladder best first, what uses it and what it does', async () => {
    fakeProfiles()
    serveDetails({ 'hd-primary': configuredHd() })
    await open('Profiles')
    const hd = await screen.findByRole('region', { name: 'HD' })
    expect(await within(hd).findByText('6 Titles')).toBeInTheDocument()
    // Remux first, the cutoff dark, the quality turned off struck through.
    expect(within(hd).getByText('Remux 1080p').compareDocumentPosition(within(hd).getByText('WEBRip 1080p')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(hd).getByText('WEB-DL 1080p')).toHaveAttribute('title', 'Good enough here')
    expect(within(hd).getByText('WEB-DL 1080p')).toHaveAttribute('data-tone', 'cutoff')
    expect(within(hd).getByText('HDTV 1080p')).toHaveAttribute('title', 'Not accepted')
    expect(within(hd).getByText('HDTV 1080p')).toHaveAttribute('data-tone', 'no')
    expect(within(hd).getByText('1 – 10 GB per episode')).toBeInTheDocument()
    expect(within(hd).getByText('Primary Language audio')).toBeInTheDocument()
    expect(within(hd).getByText('Upgrade until Score 2,000')).toBeInTheDocument()
    expect(within(hd).getByText('12 files below the cutoff')).toBeInTheDocument()
    expect(within(hd).getByText('Default for Movies and Series')).toBeInTheDocument()
    expect(within(await screen.findByRole('region', { name: 'New Titles get' })).getByText('HD')).toBeInTheDocument()

    // A Profile nobody set up says Upgrades never stop; one with a cutoff but no Score stops at the cutoff.
    const any = screen.getByRole('region', { name: 'Any' })
    expect(await within(any).findByText('Upgrades never stop')).toBeInTheDocument()
    expect(within(any).queryByText(/per episode/)).not.toBeInTheDocument()
    expect(within(any).queryByText(/below the cutoff/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Change…' }))
    expect(await screen.findByLabelText('4K default for Movies')).toBeInTheDocument()
  })

  it('names every Slot in the defaults line, offers every Profile for each, and warns about a shared default', async () => {
    fakeProfiles()
    const warning = { code: 'shared_slot_default' as const, kind: 'movies', profile: 'hd-primary', slots: ['standard', '4k'], message: 'Standard and 4K both default to HD for Movies' }
    server.use(
      http.get('/slots', ({ response }) =>
        response(200).json({ items: [...seededSlots(), { ...seededSlots()[0], id: 'remux', label: 'Remux', position: 2, default_movies: 'any-primary', default_series: null }] }),
      ),
      http.get('/settings', ({ response }) =>
        response(200).json({
          language_region: { primary_language: 'en', release_date_country: 'US' },
          check_github_updates: true,
          pause_grabs: false,
          display: displayDefaults,
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
          trash: { auto_update: true },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
          root_folders: { movies: ['/m'], series: ['/s'] },
          warnings: [warning],
        }),
      ),
    )
    serveDetails()
    await open('Profiles')
    const line = await screen.findByRole('region', { name: 'New Titles get' })
    expect(await within(line).findByText('Movies Any, Series none')).toBeInTheDocument()
    expect(within(line).getByText('Remux')).toBeInTheDocument()
    expect(await screen.findByText('Standard and 4K both default to HD for Movies')).toBeInTheDocument()
    // A Profile's card names no Slot.
    expect(screen.queryByText(/Any Slot|Standard of/)).not.toBeInTheDocument()
  })

  it('judges the defaults by the Slots and the Profiles by the Profiles: a file that declares only one locks only that', async () => {
    fakeProfiles()
    server.use(http.get('/slots', ({ response }) => response(200).json({ items: seededSlots().map((s) => ({ ...s, from_config_file: true })) })))
    serveDetails()
    await open('Profiles')
    // The Slots are declared and the Profiles are not: a Profile can be made, the defaults cannot be changed.
    expect(await screen.findByRole('button', { name: 'New Profile…' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeDisabled()
    expect(screen.getByText(/The Config File sets the Slots, so their defaults cannot be changed here/)).toBeInTheDocument()
    expect(screen.queryByText(/The Config File sets the Profiles/)).not.toBeInTheDocument()
  })

  it('does not lock the defaults when only the Profiles are declared', async () => {
    fakeProfiles()
    server.use(http.get('/profiles', ({ response }) => response(200).json({ items: seeded().map((p) => ({ ...p, from_config_file: true })) })))
    serveDetails()
    await open('Profiles')
    expect(await screen.findByRole('button', { name: 'New Profile…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeEnabled()
    expect(screen.getByText(/The Config File sets the Profiles/)).toBeInTheDocument()
    expect(screen.queryByText(/The Config File sets the Slots/)).not.toBeInTheDocument()
  })

  const remux4k: Suggestion = { name: '4K Remux', release_family: 'remux-web', resolution: '4k', language_rule: 'primary', kinds: ['movie', 'series'] }
  const suggested: SuggestionGroup[] = [
    { release_family: 'remux-web', name: 'Remux + WEB', items: [remux4k, { name: '4K Remux German', release_family: 'remux-web', resolution: '4k', language_rule: 'de', kinds: ['movie'] }] },
    { release_family: 'sqp', name: 'SQP', items: [{ name: 'SQP 1080p', release_family: 'sqp', resolution: 'hd', language_rule: 'primary', kinds: ['movie'] }] },
  ]

  it('lists Suggested Profiles by Release Family with their kinds and the resolved language', async () => {
    fakeProfiles({ groups: suggested })
    serveDetails()
    await open('Profiles')
    const section = await screen.findByRole('region', { name: 'Suggested' })
    const remux = within(within(section).getAllByRole('group', { name: 'Remux + WEB' })[0])
    expect(remux.getByText('4K Remux')).toBeInTheDocument()
    expect(remux.getByText('Movies and Series · Primary Language (English)')).toBeInTheDocument()
    expect(within(section).getAllByRole('group', { name: 'SQP' })).toHaveLength(1)
  })

  it('puts the named-language recipes under Other languages, closed until opened', async () => {
    fakeProfiles({ groups: suggested })
    serveDetails()
    await open('Profiles')
    const section = within(await screen.findByRole('region', { name: 'Suggested' }))
    const toggle = section.getByText('Other languages')
    const disclosure = toggle.closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    // The Primary and Original recipes are outside it, the named one inside.
    expect(within(disclosure).queryByText('4K Remux')).not.toBeInTheDocument()
    expect(within(disclosure).getByText('4K Remux German')).toBeInTheDocument()
    expect(section.getByText('Movies · German')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(disclosure).toHaveAttribute('open')
  })

  it('names the Primary Language a Primary recipe resolves to', async () => {
    fakeProfiles({ groups: suggested, primary: 'de' })
    serveDetails()
    await open('Profiles')
    expect(await screen.findByText('Movies and Series · Primary Language (German)')).toBeInTheDocument()
  })

  it('moves an added Suggested Profile into the Profiles list, enabled, without a reload', async () => {
    const sent = fakeProfiles({ groups: suggested })
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Add 4K Remux' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'import', body: { release_family: 'remux-web', resolution: '4k', language_rule: 'primary' } }))
    expect(await screen.findByRole('button', { name: 'Edit 4K Remux' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add 4K Remux' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 4K Remux German' })).toBeInTheDocument() // still listed, under Other languages
  })

  it('hides Suggested when there are no suggestions', async () => {
    fakeProfiles()
    serveDetails()
    await open('Profiles')
    await screen.findByRole('button', { name: 'Edit HD' })
    expect(screen.queryByRole('region', { name: 'Suggested' })).not.toBeInTheDocument()
  })

  it('makes Suggested read-only when the Config File declares the Profiles', async () => {
    fakeProfiles({ groups: suggested })
    server.use(http.get('/profiles', ({ response }) => response(200).json({ items: seeded().map((p) => ({ ...p, from_config_file: true })) })))
    serveDetails()
    await open('Profiles')
    expect(await screen.findByRole('button', { name: 'Add 4K Remux' })).toBeDisabled()
    expect(screen.getAllByText(/The Config File sets the Profiles/)).toHaveLength(1)
  })

  it('shows each Profile’s Release Family, language and kinds', async () => {
    fakeProfiles()
    server.use(
      http.get('/profiles', ({ response }) => response(200).json({ items: [profile('r', '4K Remux German', 'de', { release_family: 'remux-web', kinds: ['movie'] }), ...seeded().slice(0, 1)] })),
    )
    serveDetails()
    await open('Profiles')
    const card = await screen.findByRole('region', { name: '4K Remux German' })
    expect(within(card).getByText('Remux + WEB')).toBeInTheDocument()
    expect(within(card).getByText('German audio')).toBeInTheDocument()
    expect(within(card).getByText('Movies')).toBeInTheDocument()
    const hd = screen.getByRole('region', { name: 'HD' })
    expect(within(hd).getByText('Bluray + WEB')).toBeInTheDocument()
    expect(within(hd).getByText('Movies and Series')).toBeInTheDocument()
  })

  it('warns when two Profiles are the same recipe', async () => {
    fakeProfiles({ warnings: [{ code: 'duplicate_profile', profiles: ['hd-primary', 'hd-original'], message: 'HD and HD English are the same recipe' }] })
    serveDetails()
    await open('Profiles')
    expect(await screen.findByText('HD and HD English are the same recipe')).toBeInTheDocument()
  })

  it('says No Upgrades past the cutoff for a cutoff with no Upgrade-until Score', async () => {
    fakeProfiles()
    const hd = configuredHd()
    serveDetails({ 'hd-primary': { ...hd, overlay: { ...hd.overlay, upgrade_until: null } } })
    await open('Profiles')
    expect(await within(await screen.findByRole('region', { name: 'HD' })).findByText('No Upgrades past the cutoff')).toBeInTheDocument()
  })

  it('edits a Profile in a side sheet: what it does with Original-only Releases, saved with the sheet’s own Save', async () => {
    const sent = fakeProfiles()
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })

    expect(await within(sheet).findByText('Saving rescores 61 files')).toBeInTheDocument()
    expect(
      within(sheet)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Remux 1080p', 'BluRay 1080p', 'WEB-DL 1080p', 'HDTV 720p'].map((q) => q))
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    const choice = within(sheet).getByLabelText('Audio')
    expect(
      within(choice)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Primary Language audio', 'Primary Language audio, or the original (offered for approval)', 'Primary Language audio, or the original language'])
    await userEvent.selectOptions(choice, 'offer')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'profile hd-primary', body: { original_language: 'offer' } }))
    expect(await findToast('Saved HD')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'HD' })).not.toBeInTheDocument())
  })

  it('opens a Profile’s checklist as the user set it, and sends the whole overlay when a field changes', async () => {
    const sent = fakeProfiles()
    serveDetails({ 'hd-primary': configuredHd() })
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })

    const items = () => within(sheet).getAllByRole('listitem')
    expect(items().map((li) => li.textContent)).toEqual(['Remux 1080p', 'BluRay 1080p', 'WEB-DL 1080pcutoff', 'WEBRip 1080p', 'HDTV 1080pnot accepted'])
    expect(within(sheet).getByRole('checkbox', { name: 'Accept HDTV 1080p' })).toHaveAttribute('aria-checked', 'false')
    expect(within(sheet).getByRole('checkbox', { name: 'Accept WEB-DL 1080p' })).toHaveAttribute('aria-checked', 'true')
    expect(within(sheet).getByLabelText('Good enough at')).toHaveValue('WEBDL-1080p')
    expect(within(sheet).getByLabelText('Upgrade until Score')).toHaveValue('2000')
    expect(within(sheet).getByLabelText('Minimum Score')).toHaveValue('0')
    expect(within(sheet).getByLabelText('Size per episode, smallest in GB')).toHaveValue('1')
    expect(within(sheet).getByLabelText('Size per episode, largest in GB')).toHaveValue('10')
    expect(within(sheet).getByText(/12 files below the cutoff in this Profile/)).toBeInTheDocument()
    expect(within(sheet).getByText('Saving rescores 61 files')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()

    await userEvent.clear(within(sheet).getByLabelText('Upgrade until Score'))
    await userEvent.type(within(sheet).getByLabelText('Upgrade until Score'), '2500')
    await userEvent.clear(within(sheet).getByLabelText('Size per episode, largest in GB'))
    await userEvent.type(within(sheet).getByLabelText('Size per episode, largest in GB'), '20')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent.at(-1)?.path).toBe('profile hd-primary'))
    const overlay = (sent.at(-1)?.body as { overlay: Details['overlay'] }).overlay
    expect(overlay.upgrade_until).toBe(2500)
    expect(overlay.episode_size).toEqual({ min: GB, max: 20 * GB })
    expect(overlay.series.cutoff).toBe('WEBDL-1080p')
    expect(overlay.series.qualities?.map((q) => `${q.name}:${q.accepted}`)).toEqual(['Remux-1080p:true', 'Bluray-1080p:true', 'WEBDL-1080p:true', 'WEBRip-1080p:true', 'HDTV-1080p:false'])
    expect(overlay.movies).toEqual({ cutoff: null, qualities: null })
  })

  it('reorders the checklist with the arrow keys on a row’s handle and by dragging, and a tick turns a quality off', async () => {
    const sent = fakeProfiles()
    serveDetails({ 'hd-primary': configuredHd() })
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    const order = () =>
      within(sheet)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.replace(/cutoff|not accepted/, ''))

    const handle = within(sheet).getByRole('button', { name: 'Move WEB-DL 1080p' })
    handle.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(order()).toEqual(['Remux 1080p', 'WEB-DL 1080p', 'BluRay 1080p', 'WEBRip 1080p', 'HDTV 1080p'])
    expect(await within(sheet).findByText('WEB-DL 1080p is number 2 of 5')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(order()).toEqual(['Remux 1080p', 'BluRay 1080p', 'WEBRip 1080p', 'WEB-DL 1080p', 'HDTV 1080p'])
    // Moving past either end does nothing.
    within(sheet).getByRole('button', { name: 'Move Remux 1080p' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(order()[0]).toBe('Remux 1080p')

    // Dragging a row onto another puts it there.
    const rows = within(sheet).getAllByRole('listitem')
    const data = { effectAllowed: 'move', setData: () => undefined, getData: () => '' }
    fireEvent.dragStart(rows[4], { dataTransfer: data })
    fireEvent.dragOver(rows[0], { dataTransfer: data })
    fireEvent.drop(rows[0], { dataTransfer: data })
    expect(order()[0]).toBe('HDTV 1080p')

    // Turning the cutoff quality off takes the cutoff away (it must be accepted).
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Accept WEB-DL 1080p' }))
    expect(within(sheet).getByLabelText('Good enough at')).toHaveValue('')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent.at(-1)?.path).toBe('profile hd-primary'))
    const overlay = (sent.at(-1)?.body as { overlay: Details['overlay'] }).overlay
    expect(overlay.series.cutoff).toBeNull()
    expect(overlay.series.qualities?.map((q) => `${q.name}:${q.accepted}`)).toEqual(['HDTV-1080p:false', 'Remux-1080p:true', 'Bluray-1080p:true', 'WEBRip-1080p:true', 'WEBDL-1080p:false'])
  })

  it('Reset to TRaSH puts the TRaSH order and ticks back and saves no quality list', async () => {
    const sent = fakeProfiles()
    serveDetails({ 'hd-primary': configuredHd() })
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Reset to TRaSH' }))
    expect(within(sheet).getByRole('checkbox', { name: 'Accept HDTV 1080p' })).toHaveAttribute('aria-checked', 'true')
    expect(within(sheet).getByRole('button', { name: 'Reset to TRaSH' })).toBeDisabled()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent.at(-1)?.path).toBe('profile hd-primary'))
    const overlay = (sent.at(-1)?.body as { overlay: Details['overlay'] }).overlay
    expect(overlay.series.qualities).toBeNull()
    expect(overlay.series.cutoff).toBe('WEBDL-1080p')
  })

  it('refuses a smallest size above the largest before sending anything', async () => {
    const sent = fakeProfiles()
    serveDetails()
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit HD' }))
    const sheet = await screen.findByRole('dialog', { name: 'HD' })
    await userEvent.type(await within(sheet).findByLabelText('Size per Movie, smallest in GB'), '30')
    await userEvent.type(within(sheet).getByLabelText('Size per Movie, largest in GB'), '5')
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Size per Movie: the smallest size is above the largest.')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(sent).toEqual([])
  })

  it('makes a New Profile as a copy and opens it, and deletes a custom Profile nobody uses', async () => {
    const sent = fakeProfiles()
    const custom = { ...seeded()[0], key: 'custom-1', name: 'Movies', default_movies: false, default_series: false, custom: true }
    server.use(
      http.post('/profiles', async ({ request, response }) => {
        sent.push({ path: 'create', body: await request.json() })
        return response(201).json(custom)
      }),
      http.delete('/profiles/{key}', ({ params, response }) => {
        sent.push({ path: `delete ${params.key}`, body: null })
        return response(204).empty()
      }),
    )
    serveDetails({ 'custom-1': { ...configuredHd(), key: 'custom-1', titles: 0, files: 0, rescores: 0, below_cutoff: 0 } })
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'New Profile…' }))
    const ask = await screen.findByRole('dialog', { name: 'New Profile' })
    expect(within(ask).getByRole('button', { name: 'Create' })).toBeDisabled()
    await userEvent.type(within(ask).getByLabelText('Name'), 'Movies')
    await userEvent.selectOptions(within(ask).getByLabelText('Start from'), 'hd-primary')
    await userEvent.click(within(ask).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'create', body: { name: 'Movies', copy_from: 'hd-primary' } }))
  })
  const withCustom = (titles: number) => {
    const sent = fakeProfiles()
    const custom = { ...seeded()[0], key: 'custom-1', name: 'Movies', default_movies: false, default_series: false, custom: true }
    server.use(
      http.get('/profiles', ({ response }) => response(200).json({ items: [...seeded(), custom] })),
      http.delete('/profiles/{key}', ({ params, response }) => {
        sent.push({ path: `delete ${params.key}`, body: null })
        return response(204).empty()
      }),
    )
    serveDetails({ 'custom-1': { ...configuredHd(), key: 'custom-1', below_cutoff: 0, titles, files: titles * 3, rescores: titles * 3 } })
    return sent
  }

  it('cannot delete a custom Profile while Titles use it', async () => {
    withCustom(2)
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Movies' }))
    const sheet = await screen.findByRole('dialog', { name: 'Movies' })
    expect(await within(sheet).findByLabelText('Name')).toHaveValue('Movies')
    expect(within(sheet).getByRole('button', { name: 'Delete Profile' })).toBeDisabled()
    expect(within(sheet).getByText(/2 Titles use it/)).toBeInTheDocument()
  })

  it('deletes a custom Profile nobody uses after asking', async () => {
    const sent = withCustom(0)
    await open('Profiles')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Movies' }))
    const sheet = await screen.findByRole('dialog', { name: 'Movies' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Delete Profile' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete Profile' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'delete custom-1', body: null }))
    expect(await findToast('Deleted Movies')).toBeInTheDocument()
  })
})

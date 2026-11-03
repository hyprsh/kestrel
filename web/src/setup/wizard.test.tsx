import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { fakeSetup } from '../test/fakeSetup'
import { fakeSlots, slotRecord } from '../test/slots'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Settings = components['schemas']['Settings']

/** Settings with real merge-patch behaviour for the Root folders; a patch naming a missing folder is refused. */
function fakeSettings(onSave?: (body: unknown) => void, rootFolders: Partial<Settings['root_folders']> = {}) {
  let settings: Settings = {
    language_region: { primary_language: 'en', release_date_country: 'US' },
    check_github_updates: true,
    pause_grabs: false,
    display: displayDefaults,
    from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
    trash: { auto_update: true },
    metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'], ...rootFolders },
  }
  server.use(
    http.get('/settings', ({ response }) => response(200).json(settings)),
    http.patch('/settings', async ({ request, response }) => {
      const body = (await request.json()) as { root_folders?: Partial<Settings['root_folders']> }
      onSave?.(body)
      const bad = body.root_folders?.movies?.findIndex((p) => p.includes('missing'))
      if (bad !== undefined && bad >= 0) {
        return response('default').json(
          {
            type: 'about:blank',
            title: 'unprocessable entity',
            status: 422,
            code: 'validation',
            detail: 'This folder does not exist',
            errors: [{ field: `root_folders.movies[${bad}]`, code: 'not_found', message: 'This folder does not exist' }],
          },
          { status: 422 },
        )
      }
      settings = { ...settings, root_folders: { ...settings.root_folders, ...body.root_folders } }
      return response(200).json(settings)
    }),
  )
}

type Adoption = components['schemas']['Adoption']

/** A GET /adoption that is idle until the scan is posted, then holds one planned Series. */
function fakeAdoption() {
  const state = { scans: 0 }
  const plan = (): Adoption => ({
    state: state.scans > 0 ? 'planned' : 'idle',
    progress: { done: 0, total: 0 },
    summary: { matched: state.scans > 0 ? 1 : 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: state.scans > 0 ? 1 : 0 },
    revision: 1,
    error: null,
    scanned_at: null,
    monitor: 'all',
    result: null,
  })
  server.use(
    http.get('/adoption', ({ response }) => response(200).json(plan())),
    http.post('/adoption/scan', ({ response }) => {
      state.scans++
      return response(202).json(plan())
    }),
    http.get('/adoption/rows', ({ response }) =>
      response(200).json({
        items: [
          {
            id: 1,
            kind: 'series',
            status: 'matched',
            skip_reason: null,
            entry: '/data/media/tv/Breaking Bad',
            ticked: true,
            match: { tmdb_id: 1396, tvdb_id: 81189, title: 'Breaking Bad', year: 2008, title_id: null, source: 'tag', folder: 'Breaking Bad (2008) {tvdb-81189}' },
            candidates: [],
            files: [],
          },
        ],
        next_cursor: null,
        total: 1,
        counts: { matched: 1, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 1 },
      }),
    ),
  )
  return state
}

describe('the wizard', () => {
  it('ends with an optional Adopt step that scans and leads into the review', async () => {
    fakeSettings()
    fakeSetup()
    const adoption = fakeAdoption()
    renderApp()

    const adopt = await screen.findByRole('region', { name: /Adopt existing library/ })
    await userEvent.click(await within(adopt).findByRole('button', { name: /scan for existing files/i }))

    expect(adoption.scans).toBe(1)
    expect(await within(adopt).findByLabelText('Adopt Breaking Bad (2008)')).toBeChecked()
    expect(within(adopt).getByRole('button', { name: 'Discard plan' })).toBeEnabled()
  })

  it('opens finished sections as one-line summaries and the rest as forms', async () => {
    fakeSettings()
    fakeSetup({ language: 'done' })
    renderApp()

    const language = await screen.findByRole('region', { name: 'Primary Language' })
    expect(await within(language).findByText(/English/)).toBeInTheDocument() // the summary
    expect(within(language).queryByLabelText('Release-date country')).not.toBeInTheDocument() // the form is folded
    expect(within(language).getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    const roots = screen.getByRole('region', { name: 'Root folders' })
    expect(await within(roots).findByLabelText('Movies folder 1')).toHaveValue('/data/media/movies') // todo: open, prefilled
    expect(within(roots).getByLabelText('Series folder 1')).toHaveValue('/data/media/tv')

    await userEvent.click(within(language).getByRole('button', { name: 'Edit' }))
    expect(await within(language).findByLabelText('Release-date country')).toHaveValue('US')
  })

  it('orders the sections and ends with the optional Adopt step and the Summary', async () => {
    fakeSettings()
    fakeSetup()
    fakeAdoption()
    renderApp()
    await screen.findByRole('region', { name: 'Root folders' })
    const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/^\d+/, ''))
    await waitFor(() => expect(titles()).toEqual(['Account', 'Primary Language', 'Download client', 'Indexer', 'Root folders', 'Slots', 'Profiles', 'Adopt existing library', 'Summary']))
  })

  it('folds a section once it is saved', async () => {
    const setup = fakeSetup()
    fakeSettings(() => {
      setup.sections.root_folders = 'done'
    })
    renderApp()
    const roots = await screen.findByRole('region', { name: 'Root folders' })
    await userEvent.click(await within(roots).findByRole('button', { name: 'Save root folders' }))
    await waitFor(() => expect(within(roots).queryByLabelText('Movies folder 1')).not.toBeInTheDocument())
    expect(within(roots).getByText(/\/data\/media\/movies/)).toBeInTheDocument()
  })

  it('Finish setup lists every missing section and lets the admin through once none is missing', async () => {
    fakeSettings()
    const setup = fakeSetup({ language: 'done', slots: 'done' })
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Finish setup' }))
    expect(screen.getByRole('separator')).toBeInTheDocument() // divides the sections from Finish
    const missing = await screen.findByRole('alert')
    expect(
      within(missing)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Download client', 'Indexer', 'Root folders'])
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument() // still in the wizard

    setup.sections.download_client = setup.sections.indexer = setup.sections.root_folders = 'done'
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument() // the shell
  })

  it('is what an admin with unfinished setup gets back to after logging in', async () => {
    fakeSettings()
    fakeSetup({ language: 'done' })
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Root folders' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
  })
})

describe('a Primary Language change in the background', () => {
  it('keeps the language step open while it is pending, then folds it once the server clears it, without a reload', async () => {
    let pending: string | undefined = 'de'
    server.use(
      http.get('/settings', ({ response }) =>
        response(200).json({
          language_region: { primary_language: pending ? 'en' : 'de', release_date_country: pending ? 'US' : 'DE', ...(pending ? { pending_primary_language: pending } : {}) },
          check_github_updates: true,
          pause_grabs: false,
          display: displayDefaults,
          from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
          trash: { auto_update: true },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
          root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
        } as Settings),
      ),
    )
    const setup = fakeSetup({ language: 'todo' })
    fakeAdoption()
    renderApp()

    const language = await screen.findByRole('region', { name: 'Primary Language' })
    expect(await within(language).findByText(/Switching to German/)).toBeInTheDocument()
    expect(within(language).getByLabelText('Primary Language')).toBeDisabled()

    // The server finishes the re-score: the pending change clears and the setup section reads done.
    pending = undefined
    setup.sections.language = 'done'
    await waitFor(() => expect(within(language).queryByLabelText('Release-date country')).not.toBeInTheDocument(), { timeout: 5000 })
    expect(within(language).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})

describe('running setup again', () => {
  it('opens from Settings with the account already done and every other section as a summary', async () => {
    fakeSettings()
    const setup = fakeSetup({ language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', slots: 'done' }, true)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'General' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run Setup Again…' }))

    const account = await screen.findByRole('region', { name: 'Account' })
    expect(within(account).queryByLabelText('Password')).not.toBeInTheDocument()
    expect(within(account).getByText(/admin account exists/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back to Kestrel' }))
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(setup.finishCalls).toBe(0)
  })
})

describe('Root folders', () => {
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Library' }))
    return screen.findByRole('region', { name: 'Root folders' })
  }
  const edit = async (section: HTMLElement) => {
    await userEvent.click(await within(section).findByRole('button', { name: 'Edit root folders' }))
    return section
  }

  it('read as a list per kind with the default marked, and edit on demand', async () => {
    fakeSettings(undefined, { movies: ['/data/media/movies', '/data/media/more'] })
    fakeSetup({}, true)
    const section = await open()
    const movies = within(await within(section).findByRole('region', { name: 'Movies' }))
    expect(movies.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['/data/media/moviesDefault', '/data/media/more'])
    expect(within(section).getByRole('region', { name: 'Series' })).toHaveTextContent('/data/media/tv')
    expect(within(section).queryByLabelText('Movies folder 1')).not.toBeInTheDocument()

    await edit(section)
    expect(within(section).getByLabelText('Movies folder 2')).toHaveValue('/data/media/more')
    await userEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    expect(within(section).queryByLabelText('Movies folder 1')).not.toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Edit root folders' })).toBeInTheDocument()
  })

  it('appear in Settings, prefilled and editable, and save as given', async () => {
    const saved: unknown[] = []
    fakeSettings((b) => saved.push(b))
    fakeSetup({}, true)
    const section = await edit(await open())
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/settings#settings-library')

    const movies = await within(section).findByLabelText('Movies folder 1')
    expect(movies).toHaveValue('/data/media/movies')
    await userEvent.clear(movies)
    await userEvent.type(movies, '/data/films')
    await userEvent.click(within(section).getByRole('button', { name: 'Add Movies folder' }))
    await userEvent.type(within(section).getByLabelText('Movies folder 2'), '/data/more')
    await userEvent.click(within(section).getByRole('button', { name: 'Save root folders' }))

    expect(await within(section).findByRole('button', { name: 'Edit root folders' })).toBeInTheDocument() // back to the list
    expect(saved).toEqual([{ root_folders: { movies: ['/data/films', '/data/more'], series: ['/data/media/tv'] } }])
  })

  it('marks the first folder as the default for adding a Title and lets another take over', async () => {
    const saved: unknown[] = []
    fakeSettings((b) => saved.push(b))
    fakeSetup({}, true)
    const section = await edit(await open())
    await userEvent.click(await within(section).findByRole('button', { name: 'Add Series folder' }))
    await userEvent.type(within(section).getByLabelText('Series folder 2'), '/data/anime')
    expect(within(section).getAllByText('Default')).toHaveLength(2) // first of each kind

    await userEvent.click(within(section).getByRole('button', { name: 'Make Series folder 2 the default' }))
    expect(within(section).getByLabelText('Series folder 1')).toHaveValue('/data/anime')
    await userEvent.click(within(section).getByRole('button', { name: 'Save root folders' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toEqual({ root_folders: { movies: ['/data/media/movies'], series: ['/data/anime', '/data/media/tv'] } })
  })

  it('shows what is wrong with a folder next to it', async () => {
    fakeSettings()
    fakeSetup({}, true)
    const section = await edit(await open())
    const movies = await within(section).findByLabelText('Movies folder 1')
    await userEvent.clear(movies)
    await userEvent.type(movies, '/missing')
    await userEvent.click(within(section).getByRole('button', { name: 'Save root folders' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent('This folder does not exist')
    expect(movies).toHaveAttribute('aria-invalid', 'true')
  })

  it('removes a folder but keeps at least one per kind', async () => {
    fakeSettings()
    fakeSetup({}, true)
    const section = await edit(await open())
    expect(await within(section).findByRole('button', { name: 'Remove Movies folder 1' })).toBeDisabled()
    await userEvent.click(within(section).getByRole('button', { name: 'Add Movies folder' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Movies folder 2' }))
    expect(within(section).queryByLabelText('Movies folder 2')).not.toBeInTheDocument()
  })
})

describe('the Slots step', () => {
  const presetList = (available: boolean): components['schemas']['SlotPresetList'] => ({
    available,
    items: available
      ? [
          { id: 'one-copy', name: 'One copy', slots: [{ label: 'Standard', default_movies: 'HD', default_series: 'HD', on_for_new_titles: true }] },
          {
            id: 'language-plus-original',
            name: 'German + Original',
            slots: [
              { label: 'German', default_movies: 'HD', default_series: 'HD', on_for_new_titles: true },
              { label: 'Original', default_movies: 'HD Original', default_series: 'HD Original', on_for_new_titles: true },
            ],
          },
          {
            id: 'streaming-remux-archive',
            name: 'Streaming + Remux archive',
            slots: [
              { label: 'Standard', default_movies: 'HD', default_series: 'HD', on_for_new_titles: true },
              { label: 'Remux', default_movies: '4K Remux', default_series: null, on_for_new_titles: false },
            ],
          },
        ]
      : [],
  })
  const german = [
    slotRecord('german', 'German', 0, { default_movies: 'hd', default_series: 'hd' }),
    slotRecord('original', 'Original', 1, { default_movies: 'hd-original', default_series: 'hd-original', on_for_new_titles: true }),
  ]
  const slotsStep = () => screen.findByRole('region', { name: 'Slots' })

  it('offers the presets with their Slots and defaults, above the Slots editor', async () => {
    fakeSlots({ slots: [slotRecord('standard', 'Standard', 0)], presets: { list: presetList(true), result: {} } })
    fakeSetup({ language: 'done' })
    fakeAdoption()
    renderApp()

    const step = within(await slotsStep())
    expect(await step.findByText('German + Original')).toBeInTheDocument()
    expect(step.getByText('Standard: Movies HD, Series HD · Remux: Movies 4K Remux, Series none (off for new Titles)')).toBeInTheDocument()
    expect(step.getByRole('button', { name: 'Add Slot…' })).toBeInTheDocument() // the editor
  })

  it('replaces the Slots with the chosen preset and shows them in the editor', async () => {
    const sent = fakeSlots({ slots: [slotRecord('standard', 'Standard', 0)], presets: { list: presetList(true), result: { 'language-plus-original': german } } })
    fakeSetup({ language: 'done' })
    fakeAdoption()
    renderApp()

    const step = within(await slotsStep())
    await userEvent.click(await step.findByRole('button', { name: 'Use German + Original' }))

    expect(await step.findByRole('listitem', { name: 'German' })).toBeInTheDocument()
    expect(step.getByRole('listitem', { name: 'Original' })).toBeInTheDocument()
    expect(sent.map((s) => s.path)).toContain('POST /slots/presets/language-plus-original')
  })

  it('says why a preset was refused and leaves the Slots alone', async () => {
    fakeSlots({ slots: [slotRecord('standard', 'Standard', 0)], presets: { list: presetList(true), result: {}, failing: ['one-copy'] } })
    fakeSetup({ language: 'done' })
    fakeAdoption()
    renderApp()

    const step = within(await slotsStep())
    await userEvent.click(await step.findByRole('button', { name: 'Use One copy' }))
    expect(await step.findByRole('alert')).toHaveTextContent('HD French has no backing TRaSH profile')
    expect(step.getByRole('listitem', { name: 'Standard' })).toBeInTheDocument()
  })

  it('shows only the editor once the library holds a Version', async () => {
    fakeSlots({ slots: [slotRecord('standard', 'Standard', 0)], presets: { list: presetList(false), result: {} } })
    fakeSetup({ language: 'done' })
    fakeAdoption()
    renderApp()

    const step = within(await slotsStep())
    expect(await step.findByRole('listitem', { name: 'Standard' })).toBeInTheDocument()
    expect(step.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
  })

  it('is done when the Slots on for new Titles have both defaults, and folds to a summary', async () => {
    fakeSlots({ slots: german, presets: { list: presetList(true), result: {} } })
    fakeSetup({ language: 'done', slots: 'done' })
    fakeAdoption()
    renderApp()

    const step = within(await slotsStep())
    expect(await step.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(step.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
  })
})

describe('what each step asks of you', () => {
  const doneAll = { language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', slots: 'done' } as const
  const stepOf = (name: string) => screen.findByRole('region', { name })

  it('says on every step whether it is required or can be skipped', async () => {
    fakeSettings()
    fakeSetup()
    fakeAdoption()
    renderApp()
    await screen.findByRole('region', { name: 'Root folders' })
    const need = async (name: string) => (await within(await stepOf(name)).findAllByText(/^(Required|Optional)$/)).map((n) => n.textContent)
    for (const name of ['Account', 'Primary Language', 'Download client', 'Indexer', 'Root folders', 'Slots', 'Summary']) expect(await need(name)).toEqual(['Required'])
    for (const name of ['Profiles', 'Adopt existing library']) expect(await need(name)).toEqual(['Optional'])
  })

  it('explains the Cutoff and the size limits in the Profiles step', async () => {
    fakeSettings()
    fakeSetup()
    fakeAdoption()
    renderApp()
    const profiles = await stepOf('Profiles')
    expect(await within(profiles).findByText(/Good enough at/)).toHaveTextContent(/Cutoff/)
    expect(profiles).toHaveTextContent(/size limits/)
    expect(profiles).toHaveTextContent(/Slots & Profiles/)
  })

  it('ends with a Summary that links to the Overview and Health and says media servers are connected in Settings', async () => {
    fakeSettings()
    fakeSetup(doneAll)
    fakeAdoption()
    renderApp()
    const summary = await stepOf('Summary')
    expect(within(summary).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/')
    expect(within(summary).getByRole('link', { name: 'Health' })).toHaveAttribute('href', '/health')
    expect(within(summary).getByRole('link', { name: 'Slots & Profiles' })).toHaveAttribute('href', '/settings/slots-profiles')
    expect(summary).toHaveTextContent(/Connect your media servers in Settings/)
    expect(within(summary).getByRole('link', { name: 'Media servers' })).toHaveAttribute('href', '/settings/media-servers')
    expect(summary).not.toHaveTextContent(/still to do/)
  })

  it('names what is still to do in the Summary, and a link finishes setup before it opens its place', async () => {
    fakeSettings()
    const setup = fakeSetup({ ...doneAll, indexer: 'todo' })
    fakeAdoption()
    renderApp()
    const summary = await stepOf('Summary')
    expect(summary).toHaveTextContent('Indexer: still to do')

    await userEvent.click(within(summary).getByRole('link', { name: 'Health' }))
    expect(await within(summary).findByRole('alert')).toHaveTextContent('Indexer')
    expect(location.pathname).toBe('/') // refused: the address went back

    setup.sections.indexer = 'done'
    await userEvent.click(within(summary).getByRole('link', { name: 'Health' }))
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument() // the shell
    expect(location.pathname).toBe('/health')
    history.replaceState(null, '', '/')
  })

  it('can be worked through with the keyboard from the first control to Finish setup', async () => {
    fakeSettings()
    const setup = fakeSetup(doneAll)
    fakeAdoption()
    const user = userEvent.setup()
    renderApp()
    await stepOf('Summary')
    const reached: string[] = []
    for (let i = 0; i < 80 && !reached.includes('Finish setup'); i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      reached.push(el.getAttribute('aria-label') ?? el.textContent ?? '')
    }
    // Every folded step's Edit button, the Summary's links and Finish setup, in page order.
    expect(reached.filter((n) => n === 'Edit')).toHaveLength(5)
    expect(reached.indexOf('Overview')).toBeLessThan(reached.indexOf('Health'))
    expect(reached.indexOf('Health')).toBeLessThan(reached.indexOf('Media servers'))
    expect(reached.at(-1)).toBe('Finish setup')

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(setup.finishCalls).toBe(1)
  })
})

describe('the wizard on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 639'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows every step in one column down to the Summary, with the step tags beside the titles', async () => {
    fakeSettings()
    fakeSetup()
    fakeAdoption()
    renderApp()
    const summary = await screen.findByRole('region', { name: 'Summary' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/^\d+/, ''))
    expect(headings).toEqual(['Account', 'Primary Language', 'Download client', 'Indexer', 'Root folders', 'Slots', 'Profiles', 'Adopt existing library', 'Summary'])
    expect(within(summary).getByRole('button', { name: 'Finish setup' })).toBeInTheDocument()
  })
})

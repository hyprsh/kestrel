import { displayDefaults, noDisplayDeclared } from '../test/display'
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

  it('orders the sections and ends with the optional Adopt step', async () => {
    fakeSettings()
    fakeSetup()
    fakeAdoption()
    renderApp()
    await screen.findByRole('region', { name: 'Root folders' })
    const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/^\d+/, ''))
    await waitFor(() => expect(titles()).toEqual(['Account', 'Primary Language', 'Download client', 'Indexer', 'Root folders', 'Profiles', 'Adopt existing library (optional)']))
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
    const setup = fakeSetup({ language: 'done', profiles: 'done' })
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
  }, 10000)
})

describe('running setup again', () => {
  it('opens from Settings with the account already done and every other section as a summary', async () => {
    fakeSettings()
    const setup = fakeSetup({ language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', profiles: 'done' }, true)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run setup again' }))

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
    expect(within(nav).getByRole('link', { name: 'Root folders' })).toHaveAttribute('href', '/settings#settings-root-folders')

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

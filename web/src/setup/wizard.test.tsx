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
function fakeSettings(onSave?: (body: unknown) => void) {
  let settings: Settings = {
    language_region: { primary_language: 'en', release_date_country: 'US' },
    kids_rule: { enabled: true, threshold: 6 },
    check_github_updates: true,
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
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

describe('the wizard', () => {
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

  it('orders the sections and leaves a placeholder for adopting an existing library', async () => {
    fakeSettings()
    fakeSetup()
    renderApp()
    await screen.findByRole('region', { name: 'Root folders' })
    const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/^\d+/, ''))
    await waitFor(() => expect(titles()).toEqual([
      'Account',
      'Primary Language',
      'Download client',
      'Indexer',
      'Root folders',
      'Profiles',
      'Adopt existing library (optional)',
    ]))
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
    const missing = await screen.findByRole('alert')
    expect(within(missing).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Download client', 'Indexer', 'Root folders'])
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

describe('running setup again', () => {
  it('opens from Settings with the account already done and every other section as a summary', async () => {
    fakeSettings()
    const setup = fakeSetup(
      { language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', profiles: 'done' },
      true,
    )
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

  it('appear in Settings, prefilled and editable, and save as given', async () => {
    const saved: unknown[] = []
    fakeSettings((b) => saved.push(b))
    fakeSetup({}, true)
    const section = await open()
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Root folders' })).toHaveAttribute('href', '#settings-root-folders')

    const movies = await within(section).findByLabelText('Movies folder 1')
    expect(movies).toHaveValue('/data/media/movies')
    await userEvent.clear(movies)
    await userEvent.type(movies, '/data/films')
    await userEvent.click(within(section).getByRole('button', { name: 'Add Movies folder' }))
    await userEvent.type(within(section).getByLabelText('Movies folder 2'), '/data/more')
    await userEvent.click(within(section).getByRole('button', { name: 'Save root folders' }))

    expect(await within(section).findByText('Saved.')).toBeInTheDocument()
    expect(saved).toEqual([{ root_folders: { movies: ['/data/films', '/data/more'], series: ['/data/media/tv'] } }])
  })

  it('marks the first folder as the default for adding a Title and lets another take over', async () => {
    const saved: unknown[] = []
    fakeSettings((b) => saved.push(b))
    fakeSetup({}, true)
    const section = await open()
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
    const section = await open()
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
    const section = await open()
    expect(await within(section).findByRole('button', { name: 'Remove Movies folder 1' })).toBeDisabled()
    await userEvent.click(within(section).getByRole('button', { name: 'Add Movies folder' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Movies folder 2' }))
    expect(within(section).queryByLabelText('Movies folder 2')).not.toBeInTheDocument()
  })
})

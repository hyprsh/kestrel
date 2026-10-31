import { displayDefaults, noDisplayDeclared } from '../test/display'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { detail, fakeLibrary, row, type Sent } from '../test/library'
import { server } from '../test/server'
import { findToast } from '../test/toasts'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const roots = { movies: ['/data/media/movies', '/data/media/more-movies'], series: ['/data/media/tv'] }

/** A refusal of PATCH /titles/{id} as the API words it; a 422 also names the field. */
type Refusal = { status: 409 | 422; code: string; detail: string; errors?: { field: string; code: string; message: string }[] }

/** A Library with one Movie in the first Movies Root folder; PATCH /titles/{id} answers with `refuse` or moves it. */
function fakeMovie(refuse?: Refusal) {
  const r = row(1, 'Heat', 'Heat')
  fakeLibrary([r])
  const state = { root: roots.movies[0], sent: [] as Sent[] }
  server.use(
    http.get('/settings', ({ response }) =>
      response(200).json({
        language_region: { primary_language: 'en', release_date_country: 'US' },
        check_github_updates: true,
        pause_grabs: false,
        display: displayDefaults,
        from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: noDisplayDeclared },
        trash: { auto_update: true },
        metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        root_folders: roots,
      }),
    ),
    http.get('/titles/{id}', ({ response }) => response(200).json(detail(r, { root_folder: state.root }))),
    http.patch('/titles/{id}', async ({ request, response }) => {
      const body = await request.json()
      state.sent.push({ path: 'titles', body })
      if (refuse) {
        return response(refuse.status).json({ type: 'about:blank', title: 'refused', status: refuse.status, code: refuse.code, detail: refuse.detail, errors: refuse.errors })
      }
      if (body.root_folder) state.root = body.root_folder
      return response(200).json(detail(r, { root_folder: state.root }))
    }),
  )
  return state
}

async function openPicker() {
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  await userEvent.click(await screen.findByRole('button', { name: 'More Title actions' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move' }))
  return screen.findByRole('dialog', { name: 'Move Title' })
}

describe('moving a Title to another Root folder', () => {
  it('offers the kind’s Root folders with the current one marked and moves the Title to the one picked', async () => {
    const state = fakeMovie()
    renderApp()
    const picker = await openPicker()

    const current = await within(picker).findByRole('radio', { name: '/data/media/movies (current)' })
    expect(current).toBeChecked()
    expect(within(picker).queryByRole('radio', { name: /tv/ })).not.toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: 'Move here' })).toBeDisabled()

    await userEvent.click(within(picker).getByRole('radio', { name: '/data/media/more-movies' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Move here' }))

    await waitFor(() => expect(state.sent).toEqual([{ path: 'titles', body: { root_folder: '/data/media/more-movies' } }]))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move Title' })).not.toBeInTheDocument())
    expect(await findToast('Heat moved to /data/media/more-movies')).toBeInTheDocument()
    const again = await openPicker()
    expect(await within(again).findByRole('radio', { name: '/data/media/more-movies (current)' })).toBeChecked()
  })

  const otherFilesystem = 'That Root folder is on another filesystem. Kestrel moves a Title only between Root folders on the same mount'
  it.each<Refusal & { name: string }>([
    { name: '409 folder_taken', status: 409, code: 'folder_taken', detail: "A folder named like this Title's is already in that Root folder" },
    { name: '409 import_running', status: 409, code: 'import_running', detail: 'An Import into this Title is running; try again when it is done' },
    {
      name: '422 other_filesystem',
      status: 422,
      code: 'validation',
      detail: otherFilesystem,
      errors: [{ field: 'root_folder', code: 'other_filesystem', message: otherFilesystem }],
    },
  ])('closes the picker and says in a Toast why the API refused the move ($name)', async (refusal) => {
    fakeMovie(refusal)
    renderApp()
    const picker = await openPicker()

    await userEvent.click(await within(picker).findByRole('radio', { name: '/data/media/more-movies' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Move here' }))

    expect(await findToast(`Could not move Heat: ${refusal.detail}`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Move Title' })).not.toBeInTheDocument()
  })

  it('closes without a request on Cancel', async () => {
    const state = fakeMovie()
    renderApp()
    const picker = await openPicker()

    await userEvent.click(within(picker).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Move Title' })).not.toBeInTheDocument()
    expect(state.sent).toEqual([])
  })
})

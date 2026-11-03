import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { findToast } from '../test/toasts'
import { fakeSetup } from '../test/fakeSetup'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
const problem = (status: number, code: string) => ({ type: 'about:blank', title: 'x', status, code, detail: code })

type Sent = { path: string; body?: unknown }

/** A SABnzbd that accepts one key, and the plugin API in front of it. */
function fakePlugins(opts: { fresh?: boolean; saved?: boolean; declared?: boolean; enabledDeclared?: boolean } = {}) {
  const sent: Sent[] = []
  let signedIn = !opts.fresh
  if (opts.fresh) fakeSetup()
  let saved = !!opts.saved
  const instance = () => ({
    id: 7,
    contract: 'download_client.v1',
    plugin_id: 'sabnzbd',
    name: 'SABnzbd',
    enabled: true,
    priority: 0,
    config: { url: 'http://sab:8080', movie_category: 'movies', tv_category: 'tv' },
    secrets_set: ['api_key'],
    from_config_file: !!opts.declared,
    enabled_declared: !!opts.enabledDeclared,
    last_check: null,
  })
  const result = (config: Record<string, unknown>) =>
    config.api_key === undefined || config.api_key === 'good-key' ? { ok: true, code: null, message: 'SABnzbd 4.5.1' } : { ok: false, code: 'auth', message: 'SABnzbd rejected the API key' }

  server.use(
    http.get('/auth/me', ({ response }) => (signedIn ? response(200).json(me) : response('default').json(problem(401, 'setup_required'), { status: 401 }))),
    http.post('/setup/account', ({ response }) => {
      signedIn = true
      return response(201).json(me)
    }),
    http.get('/plugin-instances', ({ response }) => response(200).json({ items: saved ? [instance()] : [], next_cursor: null })),
    http.post('/plugin-instances/test', async ({ request, response }) => {
      const body = (await request.json()) as { config: Record<string, unknown> }
      sent.push({ path: 'test', body })
      return response(200).json(result(body.config))
    }),
    http.post('/plugin-instances/{id}/test', async ({ request, response }) => {
      const body = (await request.json()) as { config: Record<string, unknown> }
      sent.push({ path: 'test saved', body })
      return response(200).json(result(body.config ?? {}))
    }),
    http.post('/plugins/{plugin_id}/options/{field}', async ({ request, params, response }) => {
      sent.push({ path: `options ${params.field}`, body: await request.json() })
      return response(200).json({
        items: [
          { value: 'movies', label: 'movies' },
          { value: 'tv', label: 'tv' },
          { value: 'films', label: 'films' },
        ],
      })
    }),
    http.post('/plugin-instances', async ({ request, response }) => {
      sent.push({ path: 'create', body: await request.json() })
      saved = true
      return response(201).json(instance())
    }),
    http.patch('/plugin-instances/{id}', async ({ request, response }) => {
      sent.push({ path: 'patch', body: await request.json() })
      return response(200).json(instance())
    }),
  )
  return sent
}

describe('the wizard SABnzbd section', () => {
  it('follows the Account step, tests live and lists SABnzbd categories', async () => {
    const sent = fakePlugins({ fresh: true })
    renderApp()

    await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    expect(await screen.findByRole('heading', { name: /download client/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument() // the wizard goes on after the account

    // The form comes from the manifest: its fields, defaults and a password-type secret.
    expect(await screen.findByLabelText('URL')).toHaveValue('')
    expect(screen.getByLabelText('API key', { selector: 'input' })).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Movie category')).toHaveValue('movies')

    // A bad key shows the error.
    await userEvent.type(screen.getByLabelText('URL'), 'http://sab:8080')
    await userEvent.type(screen.getByLabelText('API key', { selector: 'input' }), 'bad-key')
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('SABnzbd rejected the API key')
    expect(screen.getByLabelText('Movie category').tagName).toBe('INPUT') // no list without a working connection

    // A good key shows the live result and turns the categories into lists.
    await userEvent.clear(screen.getByLabelText('API key', { selector: 'input' }))
    await userEvent.type(screen.getByLabelText('API key', { selector: 'input' }), 'good-key')
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Connected: SABnzbd 4.5.1')
    const movies = await screen.findByRole('combobox', { name: 'Movie category' })
    expect(
      within(movies)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['movies', 'tv', 'films'])
    await userEvent.selectOptions(movies, 'films')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await findToast('SABnzbd saved')).toBeInTheDocument()
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
    expect(sent.at(-1)).toEqual({
      path: 'create',
      body: { plugin_id: 'sabnzbd', name: 'SABnzbd', config: { url: 'http://sab:8080', api_key: 'good-key', movie_category: 'films', tv_category: 'tv' } },
    })
  })

  it('shows the server problem when saving is refused', async () => {
    fakePlugins({ fresh: true })
    server.use(
      http.post('/plugin-instances', ({ response }) =>
        response('default').json({ ...problem(422, 'validation'), detail: 'only 1 download_client.v1 instance can be enabled at a time' }, { status: 422 }),
      ),
    )
    renderApp()
    await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await userEvent.type(await screen.findByLabelText('URL'), 'http://sab:8080')
    await userEvent.type(screen.getByLabelText('API key', { selector: 'input' }), 'good-key')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/only 1 download_client.v1 instance/)
  })
})

describe('Settings download client', () => {
  type Live = { state: 'ok' | 'failing'; message?: string | null; version?: string | null; downloading?: number | null; queued?: number | null; free_bytes?: number | null }
  const serveLive = (live: Live | null) =>
    server.use(
      http.get('/settings/downloads', ({ response }) =>
        response(200).json({
          download_client: live && {
            instance_id: 7,
            name: 'SABnzbd',
            state: live.state,
            message: live.message ?? null,
            version: live.version ?? null,
            checked_at: new Date().toISOString(),
            downloading: live.downloading ?? null,
            queued: live.queued ?? null,
            free_bytes: live.free_bytes ?? null,
          },
          indexers: [],
        }),
      ),
    )
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Downloads' }))
    return within(await screen.findByRole('region', { name: 'Download client' }))
  }
  const edit = async () => {
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Edit…' }))
    return within(await screen.findByRole('dialog', { name: 'SABnzbd' }))
  }

  it('shows the client with its status, version and when it was checked, and the strip of facts', async () => {
    fakePlugins({ saved: true })
    serveLive({ state: 'ok', version: '4.3.2', downloading: 2, queued: 1, free_bytes: 1.1 * 1024 ** 4 })
    const section = await open()
    expect(await section.findByText('SABnzbd')).toBeInTheDocument()
    expect(await section.findByText('Connected · version 4.3.2 · checked just now')).toBeInTheDocument()
    expect(section.getByText('sab:8080')).toBeInTheDocument()
    expect(section.getByText('movies · tv')).toBeInTheDocument()
    expect(section.getByText('2 downloading, 1 waiting')).toBeInTheDocument()
    expect(section.getByText('1.1 TB')).toBeInTheDocument()
    expect(section.queryByLabelText('URL')).not.toBeInTheDocument() // the form is closed until Edit…
  })

  it('shows the error in red when the client does not answer, and Unknown for what it could not read', async () => {
    fakePlugins({ saved: true })
    serveLive({ state: 'failing', message: 'cannot reach SABnzbd: connection refused' })
    const section = await open()
    expect(await section.findByText('Failing · cannot reach SABnzbd: connection refused')).toBeInTheDocument()
    expect(section.getAllByText('Unknown')).toHaveLength(2)
  })

  it('tests the saved connection from the card and tells the result', async () => {
    const sent = fakePlugins({ saved: true })
    serveLive({ state: 'ok', version: '4.3.2' })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Test' }))
    expect(await findToast('SABnzbd: SABnzbd 4.5.1')).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({ path: 'test saved', body: {} })
  })

  it('offers to add one while there is none', async () => {
    fakePlugins()
    serveLive(null)
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Add Download Client…' }))
    expect(await screen.findByLabelText('URL')).toHaveValue('')
  })

  it('never shows the saved API key and keeps it unless a new one is typed', async () => {
    const sent = fakePlugins({ saved: true })
    serveLive({ state: 'ok' })
    const form = await edit()

    const key = await form.findByLabelText('API key', { selector: 'input' })
    expect(key).toHaveValue('')
    expect(key).toHaveAttribute('placeholder', expect.stringMatching(/saved/i))
    expect(form.getByLabelText('URL')).toHaveValue('http://sab:8080')

    await userEvent.click(form.getByRole('button', { name: 'Test Connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: SABnzbd 4.5.1')
    expect(sent.find((s) => s.path === 'test saved')?.body).toEqual({
      config: { url: 'http://sab:8080', movie_category: 'movies', tv_category: 'tv' }, // no api_key: the server uses the stored one
    })

    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SABnzbd' })).not.toBeInTheDocument()) // the sheet closes
    expect(sent.at(-1)).toMatchObject({ path: 'patch', body: { config: { url: 'http://sab:8080', movie_category: 'movies', tv_category: 'tv' } } })
  })

  it('shows an instance the Config File declares as read-only, and still tests it', async () => {
    fakePlugins({ saved: true, declared: true, enabledDeclared: true })
    serveLive({ state: 'ok' })
    const form = await edit()
    expect(await form.findByLabelText('URL')).toBeDisabled()
    expect(form.getByLabelText('API key', { selector: 'input' })).toBeDisabled()
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(form.getByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(form.getByText(/Config File declares this instance/)).toBeInTheDocument()

    await userEvent.click(form.getByRole('button', { name: 'Test Connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: SABnzbd 4.5.1')
  })

  it('removes the instance', async () => {
    fakePlugins({ saved: true })
    serveLive({ state: 'ok' })
    let deleted = false
    server.use(
      http.delete('/plugin-instances/{id}', ({ response }) => {
        deleted = true
        return response(204).empty()
      }),
    )
    const form = await edit()
    await userEvent.click(await form.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleted).toBe(true))
  })
})

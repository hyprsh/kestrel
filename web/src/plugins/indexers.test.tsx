import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http, newznab, sabnzbd } from '../test/handlers'
import { server } from '../test/server'
import { fakeSetup } from '../test/fakeSetup'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
const problem = (status: number, code: string) => ({ type: 'about:blank', title: 'x', status, code, detail: code })

type Instance = components['schemas']['PluginInstance']
type Sent = { path: string; body?: unknown }

const stored = (id: number, name: string, over: Partial<Instance> = {}): Instance => ({
  id,
  contract: 'indexer.v1',
  plugin_id: 'newznab',
  name,
  enabled: true,
  priority: 0,
  config: { url: `https://${name.toLowerCase()}.example`, movie_categories: '2000', tv_categories: '5000', api_requests_per_day: null },
  secrets_set: ['api_key'],
  from_config_file: false,
  ...over,
})

/** Newznab indexers behind the plugin API. A key of "good-key" works. */
function fakeIndexers(opts: { fresh?: boolean; indexers?: Instance[] } = {}) {
  const sent: Sent[] = []
  let signedIn = !opts.fresh
  if (opts.fresh) fakeSetup()
  let items = opts.indexers ?? []
  let nextId = 100
  const result = (config: Record<string, unknown>) =>
    config.api_key === undefined || config.api_key === 'good-key'
      ? { ok: true, code: null, message: 'NZBgeek (8 categories)' }
      : { ok: false, code: 'auth', message: 'The indexer rejected the API key' }

  server.use(
    http.get('/plugins', ({ response }) => response(200).json({ items: [sabnzbd, newznab], next_cursor: null })),
    http.get('/auth/me', ({ response }) =>
      signedIn ? response(200).json(me) : response('default').json(problem(401, 'setup_required'), { status: 401 }),
    ),
    http.post('/setup/account', ({ response }) => {
      signedIn = true
      return response(201).json(me)
    }),
    http.get('/plugin-instances', ({ response }) => response(200).json({ items, next_cursor: null })),
    http.post('/plugin-instances/test', async ({ request, response }) => {
      const body = (await request.json()) as { config: Record<string, unknown> }
      sent.push({ path: 'test', body })
      return response(200).json(result(body.config))
    }),
    http.post('/plugin-instances/{id}/test', async ({ request, response }) => {
      const body = (await request.json()) as { config: Record<string, unknown> }
      sent.push({ path: 'test saved', body })
      return response(200).json(result(body.config))
    }),
    http.post('/plugin-instances', async ({ request, response }) => {
      const body = (await request.json()) as { name: string; enabled?: boolean; priority?: number; config: Record<string, unknown> }
      sent.push({ path: 'create', body })
      const made = stored(nextId++, body.name, { enabled: body.enabled ?? true, priority: body.priority ?? 0, config: body.config as Instance['config'] })
      items = [...items, made]
      return response(201).json(made)
    }),
    http.patch('/plugin-instances/{id}', async ({ request, params, response }) => {
      const body = (await request.json()) as Partial<Instance>
      sent.push({ path: 'patch', body })
      const id = Number(params.id)
      items = items.map((i) => (i.id === id ? { ...i, ...body, config: { ...i.config, ...body.config } } : i))
      return response(200).json(items.find((i) => i.id === id)!)
    }),
    http.delete('/plugin-instances/{id}', ({ params, response }) => {
      sent.push({ path: `delete ${params.id}` })
      items = items.filter((i) => i.id !== Number(params.id))
      return response(204).empty()
    }),
  )
  return sent
}

describe('the wizard Indexer section', () => {
  it('follows the Download client step and adds and tests one indexer', async () => {
    const sent = fakeIndexers({ fresh: true })
    renderApp()

    await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    const section = await screen.findByRole('region', { name: /indexer/i })
    const form = within(section)
    expect(await form.findByLabelText('Movie categories')).toHaveValue('2000')
    expect(form.getByLabelText('Series categories')).toHaveValue('5000')
    expect(form.getByLabelText('API key')).toHaveAttribute('type', 'password')
    expect(form.queryByLabelText('Name')).not.toBeInTheDocument() // the wizard adds one indexer, no names to manage

    await userEvent.type(form.getByLabelText('URL'), 'https://geek.example')
    await userEvent.type(form.getByLabelText('API key'), 'bad-key')
    await userEvent.click(form.getByRole('button', { name: 'Test connection' }))
    expect(await form.findByRole('alert')).toHaveTextContent('The indexer rejected the API key')

    await userEvent.clear(form.getByLabelText('API key'))
    await userEvent.type(form.getByLabelText('API key'), 'good-key')
    await userEvent.click(form.getByRole('button', { name: 'Test connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: NZBgeek (8 categories)')

    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(await form.findByText('Saved.')).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({
      path: 'create',
      body: {
        plugin_id: 'newznab',
        name: 'Newznab',
        config: { url: 'https://geek.example', api_key: 'good-key', movie_categories: '2000', tv_categories: '5000', api_requests_per_day: null },
      },
    })
  })

  it('leaves the download client form working beside it', async () => {
    fakeIndexers({ fresh: true })
    renderApp()
    await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    const client = within(await screen.findByRole('region', { name: /download client/i }))
    const indexer = within(await screen.findByRole('region', { name: /indexer/i }))
    expect(client.getByLabelText('Movie category')).toBeInTheDocument()
    expect(indexer.queryByLabelText('Movie category')).not.toBeInTheDocument()
    await userEvent.type(client.getByLabelText('URL'), 'http://sab:8080')
    expect(indexer.getByLabelText('URL')).toHaveValue('') // each field belongs to its own form
  })
})

describe('Settings indexers', () => {
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    return within(await screen.findByRole('region', { name: 'Indexers' }))
  }

  it('lists compact rows sorted by priority, with no form open and no key shown', async () => {
    fakeIndexers({ indexers: [stored(1, 'Slow', { enabled: false, priority: 9 }), stored(2, 'Geek', { priority: 1 }), stored(3, 'Mirror', { priority: 4, from_config_file: true })] })
    const section = await open()

    const rows = await section.findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^GeekNewznabPriority 1/),
      expect.stringMatching(/^MirrorNewznabPriority 4Declared/),
      expect.stringMatching(/^SlowNewznabPriority 9/),
    ])
    expect(section.getByLabelText('Geek enabled')).toBeChecked()
    expect(section.getByLabelText('Slow enabled')).not.toBeChecked()
    expect(section.queryByRole('form')).not.toBeInTheDocument()
    expect(section.queryByLabelText('API key')).not.toBeInTheDocument()
  })

  it('switches an indexer on and off from its row, except one the Config File declares', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow', { enabled: false }), stored(3, 'Mirror', { from_config_file: true })] })
    const section = await open()

    await userEvent.click(await section.findByLabelText('Slow enabled'))
    await waitFor(() => expect(section.getByLabelText('Slow enabled')).toBeChecked())
    expect(sent.at(-1)).toEqual({ path: 'patch', body: { enabled: true } })

    expect(section.getByLabelText('Mirror enabled')).toBeDisabled()
    expect(section.getByText('Declared')).toBeInTheDocument()
  })

  it('shows the server problem when a switch is refused', async () => {
    fakeIndexers({ indexers: [stored(1, 'Geek')] })
    server.use(
      http.patch('/plugin-instances/{id}', ({ response }) => response('default').json({ ...problem(409, 'declared'), detail: 'The Config File declares this instance' }, { status: 409 })),
    )
    const section = await open()
    await userEvent.click(await section.findByLabelText('Geek enabled'))
    expect(await section.findByRole('alert')).toHaveTextContent('The Config File declares this instance')
  })

  it('edits an indexer in place without sending its key, then folds back into its row', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Edit Geek' }))
    const geek = within(await section.findByRole('form', { name: 'Geek' }))
    expect(section.queryByRole('form', { name: 'Slow' })).not.toBeInTheDocument()
    expect(geek.getByLabelText('Name')).toHaveValue('Geek')
    expect(geek.getByLabelText('URL')).toHaveValue('https://geek.example')
    expect(geek.getByLabelText('Priority')).toHaveValue(0)
    expect(geek.getByLabelText('Enabled')).toBeChecked()
    expect(geek.getByLabelText('API key')).toHaveValue('')
    expect(geek.getByLabelText('API key')).toHaveAttribute('placeholder', expect.stringMatching(/saved/i))

    await userEvent.click(geek.getByRole('button', { name: 'Test connection' }))
    expect(await geek.findByRole('status')).toHaveTextContent('Connected: NZBgeek')
    expect(sent.find((s) => s.path === 'test saved')?.body).toMatchObject({ config: { url: 'https://geek.example' } })
    expect((sent.find((s) => s.path === 'test saved')?.body as { config: object }).config).not.toHaveProperty('api_key')

    await userEvent.clear(geek.getByLabelText('Name'))
    await userEvent.type(geek.getByLabelText('Name'), 'Geek EU')
    await userEvent.clear(geek.getByLabelText('Priority'))
    await userEvent.type(geek.getByLabelText('Priority'), '3')
    await userEvent.click(geek.getByLabelText('Enabled'))
    await userEvent.click(geek.getByRole('button', { name: 'Save' }))
    expect(await section.findByRole('button', { name: 'Edit Geek EU' })).toBeInTheDocument()
    expect(section.queryByRole('form')).not.toBeInTheDocument()
    expect(section.getByLabelText('Geek EU enabled')).not.toBeChecked()
    expect(sent.at(-1)).toEqual({
      path: 'patch',
      body: {
        name: 'Geek EU',
        enabled: false,
        priority: 3,
        config: { url: 'https://geek.example', movie_categories: '2000', tv_categories: '5000', api_requests_per_day: null },
      },
    })
  })

  it('cancels an edit and removes an indexer', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Edit Geek' }))
    await userEvent.click(within(await section.findByRole('form', { name: 'Geek' })).getByRole('button', { name: 'Cancel' }))
    expect(section.queryByRole('form')).not.toBeInTheDocument()

    await userEvent.click(section.getByRole('button', { name: 'Edit Slow' }))
    await userEvent.click(within(await section.findByRole('form', { name: 'Slow' })).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(section.queryByRole('button', { name: 'Edit Slow' })).not.toBeInTheDocument())
    expect(sent).toContainEqual({ path: 'delete 2' })
    expect(section.getByRole('button', { name: 'Edit Geek' })).toBeInTheDocument()
  })

  it('shows a declared indexer read-only in its form, and still tests it', async () => {
    fakeIndexers({ indexers: [stored(1, 'Mirror', { from_config_file: true })] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Edit Mirror' }))
    const form = within(await section.findByRole('form', { name: 'Mirror' }))
    expect(form.getByLabelText('URL')).toBeDisabled()
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(form.getByRole('button', { name: 'Remove' })).toBeDisabled()
    await userEvent.click(form.getByRole('button', { name: 'Test connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: NZBgeek')
  })

  it('adds another indexer with a name and a priority, opening the form at the end of the list', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Add indexer' }))

    const form = within(await section.findByRole('form', { name: 'New indexer' }))
    expect(form.getByLabelText('Name')).toHaveValue('')
    await userEvent.type(form.getByLabelText('Name'), 'Second')
    await userEvent.type(form.getByLabelText('URL'), 'https://second.example')
    await userEvent.type(form.getByLabelText('API key'), 'good-key')
    await userEvent.type(form.getByLabelText('API requests per day'), '100')
    await userEvent.clear(form.getByLabelText('Priority'))
    await userEvent.type(form.getByLabelText('Priority'), '5')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))

    expect(await section.findByRole('button', { name: 'Edit Second' })).toBeInTheDocument()
    expect(section.queryByRole('form')).not.toBeInTheDocument()
    expect(sent.at(-1)).toEqual({
      path: 'create',
      body: {
        plugin_id: 'newznab',
        name: 'Second',
        enabled: true,
        priority: 5,
        config: { url: 'https://second.example', api_key: 'good-key', movie_categories: '2000', tv_categories: '5000', api_requests_per_day: 100 },
      },
    })
  })

  it('cancels adding an indexer', async () => {
    fakeIndexers({ indexers: [] })
    const section = await open()
    expect(await section.findByText(/No indexers yet/)).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: 'Add indexer' }))
    await userEvent.click(within(await section.findByRole('form', { name: 'New indexer' })).getByRole('button', { name: 'Cancel' }))
    expect(section.queryByRole('form')).not.toBeInTheDocument()
    expect(section.getByRole('button', { name: 'Add indexer' })).toBeInTheDocument()
  })

  it('shows the server problem when saving is refused', async () => {
    fakeIndexers({ indexers: [] })
    server.use(
      http.post('/plugin-instances', ({ response }) =>
        response('default').json({ ...problem(422, 'validation'), detail: 'URL must be an http(s) URL' }, { status: 422 }),
      ),
    )
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Add indexer' }))
    const form = within(await section.findByRole('form', { name: 'New indexer' }))
    await userEvent.type(form.getByLabelText('Name'), 'Bad')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(await form.findByRole('alert')).toHaveTextContent('URL must be an http(s) URL')
  })
})

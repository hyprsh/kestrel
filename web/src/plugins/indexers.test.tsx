import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http, newznab, sabnzbd } from '../test/handlers'
import { server } from '../test/server'
import { findToast } from '../test/toasts'
import { fakeSetup } from '../test/fakeSetup'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false } as const
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
  enabled_declared: false,
  last_check: null,
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
    http.get('/auth/me', ({ response }) => (signedIn ? response(200).json(me) : response('default').json(problem(401, 'setup_required'), { status: 401 }))),
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
      return response(200).json(result(body.config ?? {}))
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
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    const section = await screen.findByRole('region', { name: /indexer/i })
    const form = within(section)
    expect(await form.findByLabelText('Movie categories')).toHaveValue('2000')
    expect(form.getByLabelText('Series categories')).toHaveValue('5000')
    expect(form.getByLabelText('API key')).toHaveAttribute('type', 'password')
    expect(form.queryByLabelText('Name')).not.toBeInTheDocument() // the wizard adds one indexer, no names to manage

    await userEvent.type(form.getByLabelText('URL'), 'https://geek.example')
    await userEvent.type(form.getByLabelText('API key'), 'bad-key')
    await userEvent.click(form.getByRole('button', { name: 'Test Connection' }))
    expect(await form.findByRole('alert')).toHaveTextContent('The indexer rejected the API key')

    await userEvent.clear(form.getByLabelText('API key'))
    await userEvent.type(form.getByLabelText('API key'), 'good-key')
    await userEvent.click(form.getByRole('button', { name: 'Test Connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: NZBgeek (8 categories)')

    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(await findToast('Newznab saved')).toBeInTheDocument()
    expect(form.queryByText('Saved.')).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    const client = within(await screen.findByRole('region', { name: /download client/i }))
    const indexer = within(await screen.findByRole('region', { name: /indexer/i }))
    expect(client.getByLabelText('Movie category')).toBeInTheDocument()
    expect(indexer.queryByLabelText('Movie category')).not.toBeInTheDocument()
    await userEvent.type(client.getByLabelText('URL'), 'http://sab:8080')
    expect(indexer.getByLabelText('URL')).toHaveValue('') // each field belongs to its own form
  })
})

describe('Settings indexers', () => {
  const serveGrabs = (grabs: Record<number, number>) =>
    server.use(
      http.get('/settings/downloads', ({ response }) => response(200).json({ download_client: null, indexers: Object.entries(grabs).map(([id, n]) => ({ instance_id: Number(id), grabs_30d: n })) })),
    )
  const open = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Downloads' }))
    return within(await screen.findByRole('region', { name: 'Indexers' }))
  }
  const check = (over: Partial<NonNullable<Instance['last_check']>> = {}) => ({ at: new Date().toISOString(), ok: true, code: null, message: null, ...over })
  const rowNames = (section: ReturnType<typeof within>) => section.getAllByRole('listitem').map((g: HTMLElement) => g.getAttribute('aria-label'))

  it("shows the median time an indexer's searches take, not only how long the last Test took", async () => {
    fakeIndexers({ indexers: [stored(2, 'Geek', { priority: 1, last_check: check({ latency_ms: 600 }) })] })
    server.use(
      http.get('/system/status', ({ response }) =>
        response(200).json({
          version: 'dev',
          started_at: '2026-10-01T08:00:00Z',
          services: [],
          download_client: { state: 'none', name: null, instance_id: null, message: null },
          indexers: [
            {
              instance_id: 2,
              name: 'Geek',
              state: 'ok',
              message: null,
              since: null,
              search_used: 0,
              search_max: null,
              grab_used: null,
              grab_max: null,
              search_paused_until: null,
              grabs_paused: false,
              grabs_paused_until: null,
              median_ms: 900,
            },
          ],
          disks: [],
          trash: { commit: 'abc1234', committed_at: null, checked_at: null, auto_update: true },
          grabs_paused: false,
        }),
      ),
    )
    const section = await open()

    expect(await section.findByText('OK · 0.9 s')).toBeInTheDocument()
  })

  it('lists the indexers in the order they are asked, with status, latency and Grabs of the last 30 days', async () => {
    fakeIndexers({
      indexers: [
        stored(1, 'Slow', { enabled: false, priority: 9 }),
        stored(2, 'Geek', { priority: 1, last_check: check({ latency_ms: 600 }) }),
        stored(3, 'Mirror', { priority: 4, from_config_file: true, last_check: check({ ok: false, code: 'auth', message: '401 bad API key' }) }),
      ],
    })
    serveGrabs({ 1: 6, 2: 34, 3: 1 })
    const section = await open()

    expect(await section.findByText('OK · 0.6 s')).toBeInTheDocument()
    expect(rowNames(section)).toEqual(['Geek', 'Mirror', 'Slow'])
    expect(section.getByText('Failing · 401 bad API key')).toBeInTheDocument()
    expect(section.getByText('Off')).toBeInTheDocument()
    expect(await section.findByText('34 Grabs')).toBeInTheDocument()
    expect(section.getByText('1 Grab')).toBeInTheDocument()
    expect(section.getByText('geek.example')).toBeInTheDocument()
    expect(section.getByText(/Kestrel asks indexers from top to bottom/)).toBeInTheDocument()
    expect(section.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(screen.getByText(/1 indexer needs attention/)).toBeInTheDocument()
  })

  it('says every indexer is asked at once while the enabled ones share one priority', async () => {
    fakeIndexers({ indexers: [stored(1, 'Geek', { priority: 0 }), stored(2, 'Relay', { priority: 0 }), stored(3, 'Slow', { enabled: false, priority: 5 })] })
    const section = await open()

    expect(await section.findByText('Kestrel asks every indexer at once. Drag to ask them in order instead.')).toBeInTheDocument()
  })

  it('moves an indexer with Alt and the arrow keys on its handle and saves the order as priorities', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek', { priority: 1 }), stored(2, 'Slow', { priority: 2 }), stored(3, 'Relay', { priority: 3 })] })
    const section = await open()
    await section.findByText('Geek')

    section.getByRole('button', { name: 'Move Relay' }).focus()
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')

    await waitFor(() => expect(rowNames(section)).toEqual(['Geek', 'Relay', 'Slow']))
    await waitFor(() => expect(sent.filter((s) => s.path === 'patch').map((s) => s.body)).toEqual([{ priority: 2 }, { priority: 3 }]))
  })

  it("reorders from a row's handle menu", async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek', { priority: 1 }), stored(2, 'Slow', { priority: 2 })] })
    const section = await open()
    await section.findByText('Geek')
    await userEvent.click(section.getByRole('button', { name: 'Move Slow' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Top' }))
    await waitFor(() => expect(rowNames(section)).toEqual(['Slow', 'Geek']))
    await waitFor(() => expect(sent.filter((s) => s.path === 'patch').map((s) => s.body)).toEqual([{ priority: 1 }, { priority: 2 }]))
  })

  it('keeps the order fixed, and says so, while the Config File declares an indexer', async () => {
    fakeIndexers({ indexers: [stored(1, 'Geek', { from_config_file: true, priority: 1 }), stored(2, 'Slow', { priority: 2 })] })
    const section = await open()
    await section.findByText('Geek')
    expect(section.queryByRole('button', { name: 'Move Geek' })).not.toBeInTheDocument()
    expect(section.getByText(/The Config File sets the order/)).toBeInTheDocument()
  })

  it('switches an indexer on and off from its row, except one whose enabled the Config File declares', async () => {
    const sent = fakeIndexers({
      indexers: [
        stored(1, 'Geek'),
        stored(2, 'Slow', { enabled: false }),
        stored(3, 'Mirror', { from_config_file: true, enabled_declared: true }),
        stored(4, 'Relay', { enabled: false, from_config_file: true }),
      ],
    })
    const section = await open()

    await userEvent.click(await section.findByLabelText('Slow enabled'))
    await waitFor(() => expect(section.getByLabelText('Slow enabled')).toBeChecked())
    expect(sent.at(-1)).toEqual({ path: 'patch', body: { enabled: true } })

    expect(section.getByLabelText('Mirror enabled')).toBeDisabled()

    // Declared, but the file leaves its enabled out: the row's switch works.
    expect(section.getByLabelText('Relay enabled')).toBeEnabled()
    await userEvent.click(section.getByLabelText('Relay enabled'))
    await waitFor(() => expect(section.getByLabelText('Relay enabled')).toBeChecked())
    expect(await findToast('Relay enabled')).toBeInTheDocument()
  })

  it('shows the server problem when a switch is refused', async () => {
    fakeIndexers({ indexers: [stored(1, 'Geek')] })
    server.use(http.patch('/plugin-instances/{id}', ({ response }) => response('default').json({ ...problem(409, 'declared'), detail: 'The Config File declares this instance' }, { status: 409 })))
    const section = await open()
    await userEvent.click(await section.findByLabelText('Geek enabled'))
    expect(await findToast('Could not change Geek: The Config File declares this instance')).toBeInTheDocument()
  })

  it('tests one indexer from its menu, and all of the enabled ones with Test All', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow', { enabled: false }), stored(3, 'Relay')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Geek actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Test' }))
    expect(await findToast('Geek: NZBgeek (8 categories)')).toBeInTheDocument()
    expect(sent.filter((s) => s.path === 'test saved')).toHaveLength(1)

    await userEvent.click(section.getByRole('button', { name: 'Test All' }))
    expect(await findToast('All 2 indexers answered')).toBeInTheDocument()
    expect(sent.filter((s) => s.path === 'test saved')).toHaveLength(3) // the disabled one is left alone
  })

  it('edits an indexer in a side sheet without sending its key', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Geek actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }))
    const geek = within(await screen.findByRole('dialog', { name: 'Geek' }))
    expect(geek.getByLabelText('Name')).toHaveValue('Geek')
    expect(geek.getByLabelText('URL')).toHaveValue('https://geek.example')
    expect(geek.getByLabelText('Priority')).toHaveValue(0)
    expect(geek.getByLabelText('API key')).toHaveValue('')
    expect(geek.getByLabelText('API key')).toHaveAttribute('placeholder', expect.stringMatching(/saved/i))

    await userEvent.click(geek.getByRole('button', { name: 'Test Connection' }))
    expect(await geek.findByRole('status')).toHaveTextContent('Connected: NZBgeek')
    expect((sent.find((s) => s.path === 'test saved')?.body as { config: object }).config).not.toHaveProperty('api_key')

    await userEvent.clear(geek.getByLabelText('Name'))
    await userEvent.type(geek.getByLabelText('Name'), 'Geek EU')
    await userEvent.click(geek.getByLabelText('Enabled'))
    await userEvent.click(geek.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Geek' })).not.toBeInTheDocument())
    expect(await section.findByText('Geek EU')).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({
      path: 'patch',
      body: { name: 'Geek EU', enabled: false, priority: 0, config: { url: 'https://geek.example', movie_categories: '2000', tv_categories: '5000', api_requests_per_day: null } },
    })
  })

  it('removes an indexer from its menu after asking', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek'), stored(2, 'Slow')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Slow actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove…' }))
    const ask = await screen.findByRole('alertdialog')
    expect(sent.some((s) => s.path.startsWith('delete'))).toBe(false)
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove Indexer' }))
    await waitFor(() => expect(rowNames(section)).toEqual(['Geek']))
    expect(sent).toContainEqual({ path: 'delete 2' })
  })

  it('shows a declared indexer read-only in its sheet, and still tests it', async () => {
    fakeIndexers({ indexers: [stored(1, 'Mirror', { from_config_file: true, enabled_declared: true })] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Mirror actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Mirror' }))
    expect(form.getByLabelText('URL')).toBeDisabled()
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(form.getByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(form.getByLabelText('Enabled')).toBeDisabled()
    await userEvent.click(form.getByRole('button', { name: 'Test Connection' }))
    expect(await form.findByRole('status')).toHaveTextContent('Connected: NZBgeek')
  })

  it('lets the sheet of a declared indexer switch enabled when the Config File leaves it out, and sends only that', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Relay', { from_config_file: true })] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Relay actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Relay' }))
    expect(form.getByLabelText('Name')).toBeDisabled()
    expect(form.getByLabelText('Enabled')).toBeEnabled()
    await userEvent.click(form.getByLabelText('Enabled'))
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'patch', body: { enabled: false } }))
  })

  it('adds another indexer with a name and a priority in a side sheet', async () => {
    const sent = fakeIndexers({ indexers: [stored(1, 'Geek')] })
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Add Indexer…' }))

    const form = within(await screen.findByRole('dialog', { name: 'Add an indexer' }))
    expect(form.getByLabelText('Name')).toHaveValue('')
    await userEvent.type(form.getByLabelText('Name'), 'Second')
    await userEvent.type(form.getByLabelText('URL'), 'https://second.example')
    await userEvent.type(form.getByLabelText('API key'), 'good-key')
    await userEvent.type(form.getByLabelText('API requests per day'), '100')
    await userEvent.clear(form.getByLabelText('Priority'))
    await userEvent.type(form.getByLabelText('Priority'), '5')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))

    expect(await section.findByText('Second')).toBeInTheDocument()
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
    await userEvent.click(section.getByRole('button', { name: 'Add Indexer…' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Add an indexer' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add an indexer' })).not.toBeInTheDocument())
  })

  it('shows the server problem when saving is refused', async () => {
    fakeIndexers({ indexers: [] })
    server.use(http.post('/plugin-instances', ({ response }) => response('default').json({ ...problem(422, 'validation'), detail: 'URL must be an http(s) URL' }, { status: 422 })))
    const section = await open()
    await userEvent.click(await section.findByRole('button', { name: 'Add Indexer…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add an indexer' }))
    await userEvent.type(form.getByLabelText('Name'), 'Bad')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(await form.findByRole('alert')).toHaveTextContent('URL must be an http(s) URL')
  })
})

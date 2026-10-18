import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { http } from './test/handlers'
import { server } from './test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

type Proxy = { enabled: boolean; trusted_proxies: string[]; header: string }

/** A logged-in instance whose API key and reverse-proxy settings the test controls. */
function fakeSecurity(
  opts: { key?: { prefix: string; created_at: string; from_environment?: boolean }; proxy?: Partial<Proxy>; untrusted?: boolean } = {},
) {
  let key = opts.key ?? null
  let proxy: Proxy = { enabled: false, trusted_proxies: [], header: 'Remote-User', ...opts.proxy }
  const saved: Proxy[] = []
  server.use(
    http.get('/api-key', ({ response }) =>
      response(200).json({ prefix: key?.prefix ?? null, created_at: key?.created_at ?? null, from_environment: key?.from_environment ?? false }),
    ),
    http.post('/api-key', ({ response }) => {
      key = { prefix: 'kst_NEWK', created_at: '2026-10-17T12:00:00Z' }
      return response(201).json({ key: 'kst_NEWKEYSHOWNONCE' })
    }),
    http.get('/settings/reverse-proxy', ({ response }) =>
      response(200).json({
        ...proxy,
        untrusted: opts.untrusted ? [{ ip: '203.0.113.9', value: 'mallory', count: 3, last_seen: '2026-10-17T11:00:00Z' }] : [],
      }),
    ),
    http.put('/settings/reverse-proxy', async ({ request, response }) => {
      proxy = (await request.json()) as Proxy
      saved.push(proxy)
      return response(200).json({ ...proxy, untrusted: [] })
    }),
  )
  return saved
}

const openSecurity = async () => {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return screen.findByRole('heading', { name: 'Security' })
}

describe('Settings > Security', () => {
  it('is in the jump list', async () => {
    fakeSecurity()
    await openSecurity()
    expect(screen.getByRole('navigation', { name: /settings sections/i })).toHaveTextContent('Security')
  })

  it('generates an API key, shows it once, and then only its prefix', async () => {
    fakeSecurity()
    await openSecurity()
    expect(await screen.findByText(/no api key yet/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Generate API key' }))
    expect(await screen.findByText('kst_NEWKEYSHOWNONCE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByText(/only time/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('kst_NEWKEYSHOWNONCE')).not.toBeInTheDocument()
    expect(await screen.findByText(/kst_NEWK/)).toBeInTheDocument()
  })

  it('rotates an existing key', async () => {
    fakeSecurity({ key: { prefix: 'kst_OLDK', created_at: '2026-09-01T00:00:00Z' } })
    await openSecurity()
    expect(await screen.findByText(/kst_OLDK/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Rotate API key' }))
    expect(await screen.findByText('kst_NEWKEYSHOWNONCE')).toBeInTheDocument()
  })

  it('shows a key set from the environment and does not offer to rotate it', async () => {
    fakeSecurity({ key: { prefix: 'kst_ENVK', created_at: '2026-10-17T12:00:00Z', from_environment: true } })
    await openSecurity()
    expect(await screen.findByText(/kst_ENVK/)).toBeInTheDocument()
    expect(screen.getByText(/KESTREL_API_KEY/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate API key' })).toBeDisabled()
  })

  it('saves reverse-proxy settings', async () => {
    const saved = fakeSecurity()
    await openSecurity()

    await userEvent.click(await screen.findByRole('checkbox', { name: /trust a login header/i }))
    await userEvent.type(screen.getByLabelText('Trusted proxies'), '172.18.0.0/16{Enter}10.0.0.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save reverse proxy' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
    expect(saved).toEqual([{ enabled: true, trusted_proxies: ['172.18.0.0/16', '10.0.0.5'], header: 'Remote-User' }])
  })

  it('lists addresses that sent the header without being trusted', async () => {
    fakeSecurity({ proxy: { enabled: true, trusted_proxies: ['10.0.0.5'] }, untrusted: true })
    await openSecurity()
    const warning = await screen.findByRole('region', { name: /untrusted/i })
    expect(within(warning).getByText(/203\.0\.113\.9/)).toBeInTheDocument()
    expect(within(warning).getByText(/mallory/)).toBeInTheDocument()
  })
})

describe('a proxy-authenticated session', () => {
  it('has no Log out button', async () => {
    server.use(http.get('/auth/me', ({ response }) => response(200).json({ username: 'admin', method: 'proxy', proxy_user: 'alice' })))
    renderApp()
    await screen.findByRole('button', { name: 'Settings' })
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })
})

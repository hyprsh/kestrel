import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { http } from './test/handlers'
import { server } from './test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

const me = { username: 'admin', method: 'session', proxy_user: null } as const

const body = (status: number, code: string) => ({ type: 'about:blank', title: 'x', status, code, detail: code })

/** The server state machine the SPA talks to: fresh, then logged out, then logged in. */
function fakeServer(initial: 'fresh' | 'logged-out' | 'logged-in') {
  let state = initial
  const calls: { path: string; body?: unknown }[] = []
  server.use(
    http.get('/auth/me', ({ response }) =>
      state === 'fresh'
        ? response('default').json(body(401, 'setup_required'), { status: 401 })
        : state === 'logged-out'
          ? response('default').json(body(401, 'unauthenticated'), { status: 401 })
          : response(200).json(me),
    ),
    http.post('/setup/account', async ({ request, response }) => {
      calls.push({ path: 'setup/account', body: await request.json() })
      state = 'logged-in'
      return response(201).json(me)
    }),
    http.post('/auth/login', async ({ request, response }) => {
      const sent = (await request.json()) as { password: string }
      calls.push({ path: 'login', body: sent })
      if (sent.password === 'throttled!') return response(429).json(body(429, 'rate_limited'), { headers: { 'Retry-After': '42' } })
      if (sent.password !== 'correct horse') return response('default').json(body(401, 'unauthenticated'), { status: 401 })
      state = 'logged-in'
      return response(204).empty()
    }),
    http.post('/auth/logout', ({ response }) => {
      calls.push({ path: 'logout' })
      state = 'logged-out'
      return response(204).empty()
    }),
    http.post('/auth/logout-everywhere', ({ response }) => {
      calls.push({ path: 'logout-everywhere' })
      state = 'logged-out'
      return response(204).empty()
    }),
    http.post('/account/password', async ({ request, response }) => {
      const sent = (await request.json()) as { current_password: string }
      calls.push({ path: 'password', body: sent })
      return sent.current_password === 'correct horse'
        ? response(204).empty()
        : response('default').json(body(422, 'validation'), { status: 422 })
    }),
  )
  return calls
}

describe('the wizard Account step', () => {
  it('is what a fresh instance shows, and creating the account logs the admin in', async () => {
    const calls = fakeServer('fresh')
    renderApp()

    expect(await screen.findByRole('heading', { name: /account/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument() // no shell until there is an account

    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    expect(calls).toEqual([{ path: 'setup/account', body: { username: 'admin', password: 'correct horse' } }])
  })

  it('checks the password before sending anything', async () => {
    const calls = fakeServer('fresh')
    renderApp()
    await userEvent.type(await screen.findByLabelText('Password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8/i)

    await userEvent.clear(screen.getByLabelText('Password'))
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    expect(calls).toEqual([])
  })
})

describe('the login card', () => {
  it('shows for a logged-out browser and opens the app on success', async () => {
    const calls = fakeServer('logged-out')
    renderApp()

    await userEvent.type(await screen.findByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse{Enter}') // Enter submits
    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    expect(calls).toEqual([{ path: 'login', body: { username: 'admin', password: 'correct horse' } }])
  })

  it('says so on a wrong password', async () => {
    fakeServer('logged-out')
    renderApp()
    await userEvent.type(await screen.findByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'nope nope{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password')
  })

  it('tells how long to wait when throttled', async () => {
    fakeServer('logged-out')
    renderApp()
    await userEvent.type(await screen.findByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'throttled!{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 42 s')
  })

  it('points to the container command for a forgotten password', async () => {
    fakeServer('logged-out')
    renderApp()
    expect(await screen.findByText(/kestrel reset-password/)).toBeInTheDocument()
  })
})

describe('logging out', () => {
  it('Log out in the rail returns to the login card', async () => {
    const calls = fakeServer('logged-in')
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(calls).toEqual([{ path: 'logout' }])
  })
})

describe('Settings', () => {
  const openSettings = async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  }

  it('has a jump list and an Account section', async () => {
    fakeServer('logged-in')
    await openSettings()
    const jump = screen.getByRole('navigation', { name: /settings sections/i })
    expect(jump).toHaveTextContent('Account')
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
  })

  it('changes the password', async () => {
    const calls = fakeServer('logged-in')
    await openSettings()
    await userEvent.type(screen.getByLabelText('Current password'), 'correct horse')
    await userEvent.type(screen.getByLabelText('New password'), 'brand new pass')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/password changed/i)
    expect(calls).toEqual([{ path: 'password', body: { current_password: 'correct horse', new_password: 'brand new pass' } }])
  })

  it('reports a wrong current password', async () => {
    fakeServer('logged-in')
    await openSettings()
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong')
    await userEvent.type(screen.getByLabelText('New password'), 'brand new pass')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('logs out everywhere', async () => {
    const calls = fakeServer('logged-in')
    await openSettings()
    await userEvent.click(screen.getByRole('button', { name: 'Log out everywhere' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument())
    expect(calls).toEqual([{ path: 'logout-everywhere' }])
  })
})

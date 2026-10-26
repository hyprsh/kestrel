import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeLoggedOut, problem, recordPaths, requesterMe } from '../test/plex'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

afterEach(() => vi.unstubAllGlobals())

describe('Sign in with Plex on the login card', () => {
  it('is offered only while Plex sign-in is enabled', async () => {
    fakeLoggedOut(true)
    renderApp()
    expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument() // the admin form stays
  })

  it('is not offered while it is off', async () => {
    fakeLoggedOut(false)
    const { paths, stop } = recordPaths()
    renderApp()
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    await waitFor(() => expect(paths).toContain('GET /auth/plex'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Sign in with Plex' })).not.toBeInTheDocument()
    stop()
  })

  it('starts a sign-in and sends this window to the plex.tv page', async () => {
    fakeLoggedOut(true)
    server.use(http.post('/auth/plex/pin', ({ response }) => response(200).json({ auth_url: 'https://app.plex.tv/auth#?code=ABCD' })))
    const assign = vi.fn()
    renderApp()
    const button = await screen.findByRole('button', { name: 'Sign in with Plex' })
    vi.stubGlobal('location', { ...window.location, assign })
    await userEvent.click(button)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.plex.tv/auth#?code=ABCD'))
  })

  it('says so when plex.tv cannot be reached to start', async () => {
    fakeLoggedOut(true)
    server.use(http.post('/auth/plex/pin', ({ response }) => response('default').json(problem(502, 'upstream_unavailable'), { status: 502 })))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Plex' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/plex cannot be reached/i)
  })
})

type Failure = { status: 401 | 403 | 429 | 502; code: string; headers?: Record<string, string> }

describe('coming back from Plex (?plex=1)', () => {
  /** The server after Plex authorised the PIN: `results` are the answers to POST /auth/plex/login in turn. */
  function fakeReturn(results: ('pending' | 'ok' | Failure)[]) {
    let signedIn = false
    let calls = 0
    server.use(
      http.get('/auth/me', ({ response }) => (signedIn ? response(200).json(requesterMe) : response('default').json(problem(401, 'unauthenticated'), { status: 401 }))),
      http.get('/auth/plex', ({ response }) => response(200).json({ enabled: true })),
      http.get('/my/requests', ({ response }) => response(200).json({ items: [], next_cursor: null, total: 0 })),
      http.post('/auth/plex/login', ({ response }) => {
        const result = results[Math.min(calls++, results.length - 1)]
        if (result === 'ok') {
          signedIn = true
          return response(204).empty()
        }
        if (result === 'pending') return response('default').json(problem(409, 'pending'), { status: 409 })
        return response('default').json(problem(result.status, result.code), { status: result.status, headers: result.headers })
      }),
    )
    return () => calls
  }

  it('waits while Plex has not confirmed yet, then opens the Requester app and drops the parameter', async () => {
    const calls = fakeReturn(['pending', 'ok'])
    history.replaceState(null, '', '/?plex=1')
    renderApp()

    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument() // finishing, not the form
    expect(await screen.findByText('Signing in with Plex…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your Requests' }, { timeout: 4000 })).toBeInTheDocument()
    expect(calls()).toBe(2)
    expect(location.search).toBe('')
  })

  it.each<[Failure, string | RegExp]>([
    [{ status: 403, code: 'plex_no_access' }, /can't request here.*whoever shares the Plex server/i],
    [{ status: 401, code: 'unauthenticated' }, /sign-in expired.*try again/i],
    [{ status: 429, code: 'rate_limited', headers: { 'Retry-After': '42' } }, 'Too many attempts. Try again in 42 s'],
    [{ status: 502, code: 'upstream_unavailable' }, /plex cannot be reached/i],
    [{ status: 403, code: 'plex_sign_in_off' }, /switched off/i],
  ])('explains %j, shows the form again and drops the parameter', async (failure, text) => {
    fakeReturn([failure])
    history.replaceState(null, '', '/?plex=1&x=1')
    renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(location.search).toBe('?x=1')
  })

  it('does not try to finish a sign-in without ?plex=1', async () => {
    const calls = fakeReturn(['ok'])
    renderApp()
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()
    expect(calls()).toBe(0)
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { themeScript } from '@hyprsh/design'
import { App } from './App'
import { http } from './test/handlers'
import { server } from './test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => {
  localStorage.clear()
  // chrome-ok: the dark class on <html> is the theme behaviour
  document.documentElement.classList.remove('dark')
})

describe('the app with its own client', () => {
  it('asks for the session once, however many components use it', async () => {
    let asked = 0
    server.use(
      http.get('/auth/me', ({ response }) => {
        asked++
        return response(200).json({ username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false })
      }),
    )
    render(<App />)
    await screen.findByRole('navigation')
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(asked).toBe(1)
  })
})

describe('the empty shell', () => {
  it('shows the icon rail with every top-level screen', async () => {
    renderApp()
    const rail = await screen.findByRole('navigation')
    for (const name of ['Overview', 'Library', 'Upcoming', 'Log', 'Settings']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    await waitFor(() => expect(screen.getByRole('main')).toHaveTextContent(/downloading/i)) // Overview is the home screen
  })

  it('switches the screen title when a rail item is chosen', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
  })

  it('goes back to the Overview when the Kestrel logo, which is the Overview button, is clicked', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const logo = screen.getByRole('button', { name: 'Overview' })
    expect(logo).not.toHaveAttribute('aria-current')
    await userEvent.click(logo)
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(logo).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('button', { name: 'Overview' })).toHaveLength(1) // the rail has no second Overview button
    await waitFor(() => expect(screen.getByRole('main')).toHaveTextContent(/downloading/i))
  })

  it('shows Health as a rail button, linking to Health, and not the version', async () => {
    server.use(http.get('/system', ({ response }) => response(200).json({ version: '9.9.9', commit: '', api_major: 1, base_url: '' })))
    renderApp()
    const pill = await within(await screen.findByRole('navigation')).findByRole('button', { name: /health · all checks ok/i })
    await userEvent.click(pill)
    expect(location.pathname).toBe('/health')
    expect(screen.queryByText(/9\.9\.9/)).not.toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    server.use(http.get('/system', () => HttpResponse.error()))
    renderApp()
    const pill = await within(await screen.findByRole('navigation')).findByRole('button', { name: /offline/i })
    expect(pill).not.toHaveAccessibleName(/health/i)
    expect(screen.queryByRole('banner')).not.toBeInTheDocument() // no top bar holds the pill
  })
})

describe('light and dark mode', () => {
  it('toggles the dark class and remembers the choice', async () => {
    const { unmount } = renderApp()
    const toggle = await screen.findByRole('button', { name: /theme/i })

    await userEvent.click(toggle) // system -> light
    await userEvent.click(toggle) // light -> dark
    // chrome-ok: the dark class on <html> is the theme behaviour
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('kestrel.theme')).toBe('dark')

    unmount()
    // chrome-ok: the dark class on <html> is the theme behaviour
    document.documentElement.classList.remove('dark')
    // A reload: the pre-paint script vite injects into index.html applies the stored choice before React runs.
    new Function(themeScript({ storageKey: 'kestrel.theme', attribute: 'class' }))()
    // chrome-ok: the dark class on <html> is the theme behaviour
    expect(document.documentElement).toHaveClass('dark') // restored from storage
    renderApp()
    expect(await screen.findByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument()
  })

  it("keeps the command menu's Switch theme in step with the rail button", async () => {
    renderApp()
    await screen.findByRole('button', { name: 'Theme: System' })
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(await screen.findByRole('option', { name: /Switch theme/ }))
    expect(await screen.findByRole('button', { name: 'Theme: Light' })).toBeInTheDocument()
    expect(localStorage.getItem('kestrel.theme')).toBe('light')
  })
})

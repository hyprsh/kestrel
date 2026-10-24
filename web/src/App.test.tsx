import { render, screen, within } from '@testing-library/react'
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

describe('the empty shell', () => {
  it('shows the icon rail with every top-level screen', async () => {
    renderApp()
    const rail = await screen.findByRole('navigation')
    for (const name of ['Overview', 'Library', 'Upcoming', 'Log', 'Settings', 'About']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('main')).toHaveTextContent(/downloading now/i) // Overview is the home screen
  })

  it('switches the screen title when a rail item is chosen', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Library')
  })

  it('goes back to the Overview when the Kestrel logo is clicked', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kestrel, go to Overview' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Overview')
    expect(screen.getByRole('main')).toHaveTextContent(/downloading now/i)
  })

  it('shows the server version read through the generated client', async () => {
    server.use(http.get('/system', ({ response }) => response(200).json({ version: '9.9.9', api_major: 1, base_url: '' })))
    renderApp()
    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    server.use(http.get('/system', () => HttpResponse.error()))
    renderApp()
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
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

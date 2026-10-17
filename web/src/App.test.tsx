import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { App } from './App'
import { http } from './test/handlers'
import { server } from './test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('the empty shell', () => {
  it('shows the icon rail with every top-level screen', () => {
    renderApp()
    const rail = screen.getByRole('navigation')
    for (const name of ['Overview', 'Library', 'Upcoming', 'Log', 'Settings', 'About']) {
      expect(rail).toHaveTextContent(name) // tooltip labels are in the DOM
    }
    expect(screen.getByRole('main')).toHaveTextContent(/nothing here yet/i)
  })

  it('switches the screen title when a rail item is chosen', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('banner')).toHaveTextContent('Library')
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
    const toggle = screen.getByRole('button', { name: /theme/i })

    await userEvent.click(toggle) // system -> light
    await userEvent.click(toggle) // light -> dark
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('kestrel.theme')).toBe('dark')

    unmount()
    document.documentElement.classList.remove('dark')
    renderApp()
    expect(document.documentElement).toHaveClass('dark') // restored from storage
  })
})

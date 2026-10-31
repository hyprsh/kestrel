import '@testing-library/jest-dom/vitest'
import { Toast } from '@hyprsh/design'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

// Unhandled requests fail the test: every call the SPA makes needs a handler typed from the spec.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  Toast.toasts.clear() // a Toast from one test must not show in the next
  server.resetHandlers()
  sessionStorage.clear()
  localStorage.clear() // remembered UI state (open seasons, theme) must not leak into the next test
  history.replaceState(null, '', '/') // nor the screen and filter in the address bar
})
afterAll(() => server.close())

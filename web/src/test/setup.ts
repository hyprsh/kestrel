import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

// Unhandled requests fail the test: every call the SPA makes needs a handler typed from the spec.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear() // remembered UI state (open seasons, theme) must not leak into the next test
})
afterAll(() => server.close())

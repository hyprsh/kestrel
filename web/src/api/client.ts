import createClient from 'openapi-fetch'
import type { paths } from './schema.gen'

/**
 * The API root. index.html carries a <base href> set by the server to
 * KESTREL_BASE_URL, so resolving against it works under any prefix.
 */
export const apiBaseUrl = new URL('api/v1', document.baseURI).href

/** Typed client generated from openapi.yaml. */
export const api = createClient<paths>({
  baseUrl: apiBaseUrl,
  // The server refuses state-changing requests that are not JSON (CSRF rule), so say so on every call.
  headers: { 'Content-Type': 'application/json' },
  fetch: (request) => fetch(request), // look fetch up per call so test mocks apply
})

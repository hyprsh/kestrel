import { createOpenApiHttp } from 'openapi-msw'
import type { paths } from '../api/schema.gen'
import { apiBaseUrl } from '../api/client'

/** MSW's `http`, typed from openapi.yaml: unknown paths and mismatched bodies fail to compile. */
export const http = createOpenApiHttp<paths>({ baseUrl: apiBaseUrl })

/** Default handlers: a healthy instance with the admin logged in. Tests override with `server.use(...)`. */
export const handlers = [
  http.get('/system', ({ response }) => response(200).json({ version: '0.0.0-test', api_major: 1, base_url: '' })),
  http.get('/auth/me', ({ response }) => response(200).json({ username: 'admin', method: 'session', proxy_user: null })),
  http.get('/api-key', ({ response }) => response(200).json({ prefix: null, created_at: null })),
  http.get('/settings/reverse-proxy', ({ response }) =>
    response(200).json({ enabled: false, trusted_proxies: [], header: 'Remote-User', untrusted: [] }),
  ),
]

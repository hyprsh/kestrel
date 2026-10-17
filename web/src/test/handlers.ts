import { createOpenApiHttp } from 'openapi-msw'
import type { components, paths } from '../api/schema.gen'
import { apiBaseUrl } from '../api/client'

/** MSW's `http`, typed from openapi.yaml: unknown paths and mismatched bodies fail to compile. */
export const http = createOpenApiHttp<paths>({ baseUrl: apiBaseUrl })

/** The SABnzbd manifest as the server describes it. */
export const sabnzbd: components['schemas']['PluginManifest'] = {
  id: 'sabnzbd',
  name: 'SABnzbd',
  contract: 'download_client.v1',
  version: '1',
  capabilities: { protocols: ['usenet'] },
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, default: null, help: 'Where Kestrel reaches SABnzbd.', options: [], live: false },
    { key: 'api_key', label: 'API key', type: 'secret', required: true, default: null, help: 'The full API key.', options: [], live: false },
    { key: 'movie_category', label: 'Movie category', type: 'text', required: false, default: 'movies', help: '', options: [], live: true },
    { key: 'tv_category', label: 'Series category', type: 'text', required: false, default: 'tv', help: '', options: [], live: true },
  ],
}

/** Default handlers: a healthy instance with the admin logged in. Tests override with `server.use(...)`. */
export const handlers = [
  http.get('/system', ({ response }) => response(200).json({ version: '0.0.0-test', api_major: 1, base_url: '' })),
  http.get('/plugins', ({ response }) => response(200).json({ items: [sabnzbd], next_cursor: null })),
  http.get('/plugin-instances', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  http.get('/auth/me', ({ response }) => response(200).json({ username: 'admin', method: 'session', proxy_user: null })),
]

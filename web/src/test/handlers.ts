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

/** The Newznab manifest as the server describes it. */
export const newznab: components['schemas']['PluginManifest'] = {
  id: 'newznab',
  name: 'Newznab',
  contract: 'indexer.v1',
  version: '1',
  capabilities: { protocols: ['usenet'] },
  fields: [
    { key: 'url', label: 'URL', type: 'url', required: true, default: null, help: 'The indexer address.', options: [], live: false },
    { key: 'api_key', label: 'API key', type: 'secret', required: true, default: null, help: 'Your API key.', options: [], live: false },
    { key: 'movie_categories', label: 'Movie categories', type: 'text', required: false, default: '2000', help: '', options: [], live: false },
    { key: 'tv_categories', label: 'Series categories', type: 'text', required: false, default: '5000', help: '', options: [], live: false },
    { key: 'api_requests_per_day', label: 'API requests per day', type: 'int', required: false, default: null, help: '', options: [], live: false },
  ],
}

/** Default handlers: a healthy instance with the admin logged in. Tests override with `server.use(...)`. */
export const handlers = [
  http.get('/system', ({ response }) => response(200).json({ version: '0.0.0-test', api_major: 1, base_url: '' })),
  http.get('/plugins', ({ response }) => response(200).json({ items: [sabnzbd], next_cursor: null })),
  http.get('/plugin-instances', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  http.get('/auth/me', ({ response }) => response(200).json({ username: 'admin', method: 'session', proxy_user: null })),
  http.get('/api-key', ({ response }) => response(200).json({ prefix: null, created_at: null })),
  http.get('/setup', ({ response }) =>
    response(200).json({
      account_exists: true,
      completed: true,
      sections: { account: 'done', language: 'done', download_client: 'done', indexer: 'done', root_folders: 'done', profiles: 'done' },
    }),
  ),
  http.get('/settings', ({ response }) =>
    response(200).json({
      language_region: { primary_language: 'en', release_date_country: 'US' },
      kids_rule: { enabled: true, threshold: 6 },
      root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
    }),
  ),
  http.get('/profiles', ({ response }) => response(200).json({ items: [] })),
  http.get('/titles', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  http.get('/queue', ({ response }) => response(200).json({ items: [] })),
  http.get('/attention', ({ response }) =>
    response(200).json({ count: 0, severity: null, rows: [], long_missing: { count: 0, items: [] } }),
  ),
  http.get('/system/status', ({ response }) =>
    response(200).json({ download_client: { state: 'none', name: null, instance_id: null, message: null }, indexers: [], disks: [] }),
  ),
  http.get('/settings/reverse-proxy', ({ response }) =>
    response(200).json({ enabled: false, trusted_proxies: [], header: 'Remote-User', untrusted: [] }),
  ),
]

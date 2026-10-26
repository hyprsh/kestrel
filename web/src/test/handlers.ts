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
  http.get('/auth/me', ({ response }) => response(200).json({ username: 'admin', role: 'admin', method: 'session', proxy_user: null, from_config_file: false })),
  http.get('/api-key', ({ response }) => response(200).json({ prefix: null, created_at: null, from_environment: false })),
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
      check_github_updates: true,
      pause_grabs: false,
      from_config_file: { language_region: false, root_folders: false, check_github_updates: false },
      trash: { auto_update: true },
      metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
      root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
    }),
  ),
  http.get('/profiles', ({ response }) => response(200).json({ items: [] })),
  http.get('/titles', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  http.get('/queue', ({ response }) => response(200).json({ items: [] })),
  http.get('/grabs', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  http.get('/blocklist', ({ response }) => response(200).json({ items: [] })),
  http.get('/upcoming', ({ request, response }) => {
    const q = new URL(request.url).searchParams
    return response(200).json({ from: q.get('from') ?? '', to: q.get('to') ?? '', items: [] })
  }),
  http.get('/recent', ({ response }) => response(200).json({ items: [], total: 0 })),
  http.get('/requests', ({ response }) => response(200).json({ items: [], next_cursor: null, total: 0 })),
  http.get('/search/status', ({ response }) =>
    response(200).json({ due: { versions: 0, episodes: 0, upgrades: 0 }, pass: null, next_pass_at: null, last_pass: null, upgrades_per_pass: 5, indexers: [] }),
  ),
  http.get('/jobs', ({ response }) => response(200).json({ items: [] })),
  http.get('/attention', ({ response }) => response(200).json({ count: 0, severity: null, rows: [], long_missing: { count: 0, items: [] }, originals: { count: 0, items: [] } })),
  http.get('/system/status', ({ response }) =>
    response(200).json({
      download_client: { state: 'none', name: null, instance_id: null, message: null },
      indexers: [],
      disks: [],
      trash: { commit: 'abc1234', committed_at: null, checked_at: null, auto_update: true },
      grabs_paused: false,
    }),
  ),
  http.get('/settings/reverse-proxy', ({ response }) => response(200).json({ enabled: false, trusted_proxies: [], header: 'Remote-User', untrusted: [], from_config_file: false })),
]

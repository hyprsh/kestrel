import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

export type Me = components['schemas']['Me']

export const requesterMe: Me = { username: 'anna', role: 'requester', method: 'plex', proxy_user: null, from_config_file: false }

/** A problem response body, the way the server writes one. */
export const problem = (status: number, code: string) => ({ type: 'about:blank', title: code, status, code, detail: code })

/** The paths the SPA calls while a test runs, so a test can see what a Requester's screen asked for. */
export function recordPaths() {
  const paths: string[] = []
  const on = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    paths.push(`${request.method} ${url.pathname.replace(/^.*\/api\/v1/, '')}`)
  }
  server.events.on('request:start', on)
  return { paths, stop: () => server.events.removeListener('request:start', on) }
}

/** An instance with a Plex server among its media servers. */
export const plexInstance = (name: string, id = 3): components['schemas']['PluginInstance'] => ({
  id,
  contract: 'media_server.v1',
  plugin_id: 'plex',
  name,
  enabled: true,
  priority: 0,
  config: {},
  secrets_set: ['token'],
  from_config_file: false,
  enabled_declared: false,
  last_check: null,
})

/** A logged-out browser, with Plex sign-in offered or not. */
export function fakeLoggedOut(plexEnabled: boolean) {
  server.use(
    http.get('/auth/me', ({ response }) => response('default').json(problem(401, 'unauthenticated'), { status: 401 })),
    http.get('/auth/plex', ({ response }) => response(200).json({ enabled: plexEnabled })),
  )
}

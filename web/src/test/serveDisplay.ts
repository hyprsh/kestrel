import { displayDefaults, noDisplayDeclared } from './display'
import { http } from './handlers'
import { server } from './server'

type Display = Record<string, unknown> & { upcoming_filters: object }

/**
 * Serves /settings with the given Display settings (and the ones the Config File declares), and records each
 * PATCH /settings body in `patched`, applying a patch's display part to what it serves next.
 */
export function serveDisplay(display: Partial<Record<keyof typeof displayDefaults, unknown>> = {}, declared: Partial<typeof noDisplayDeclared> = {}) {
  const state = { display: { ...displayDefaults, ...display } as Display, patched: [] as unknown[] }
  const body = () => ({
    language_region: { primary_language: 'en', release_date_country: 'US' },
    check_github_updates: true,
    pause_grabs: false,
    display: state.display,
    from_config_file: { language_region: false, root_folders: false, check_github_updates: false, display: { ...noDisplayDeclared, ...declared } },
    trash: { auto_update: true },
    metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
    root_folders: { movies: ['/data/media/movies'], series: ['/data/media/tv'] },
  })
  server.use(
    http.get('/settings', ({ response }) => response(200).json(body() as never)),
    http.patch('/settings', async ({ request, response }) => {
      const patch = (await request.json()) as { display?: Record<string, unknown> & { upcoming_filters?: object } }
      state.patched.push(patch)
      const { upcoming_filters, ...rest } = patch.display ?? {}
      state.display = { ...state.display, ...rest, upcoming_filters: { ...state.display.upcoming_filters, ...upcoming_filters } } as Display
      return response(200).json(body() as never)
    }),
  )
  return state
}

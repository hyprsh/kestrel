import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

type Me = components['schemas']['Me']

/** What the server says about this browser: no account yet, not logged in, or logged in. */
export type Auth = { state: 'setup_required' } | { state: 'unauthenticated' } | { state: 'ok'; me: Me }

/** A failed call, carrying the server's stable problem code and, for 429, the wait in seconds. */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryAfter?: number,
    /** Per-field validation errors of a 422. */
    public fields: { field: string; code: string; message: string }[] = [],
  ) {
    super(message)
  }
}

type Problem = { code?: string; detail?: string; title?: string; errors?: { field: string; code: string; message: string }[] } | undefined

/** The ApiError for a failed response: its Problem code, message, Retry-After and field errors. */
export function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  const retry = Number(response.headers.get('Retry-After'))
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed', retry > 0 ? retry : undefined, p?.errors ?? [])
}

export function useSystem() {
  return useQuery({
    queryKey: ['system'],
    queryFn: async () => {
      const { data, error } = await api.GET('/system')
      if (error) throw error
      return data
    },
  })
}

/** The SPA's first call: decides between the wizard, the login card and the app. */
export function useAuth() {
  return useQuery({
    queryKey: ['auth'],
    retry: false,
    queryFn: async (): Promise<Auth> => {
      const { data, error, response } = await api.GET('/auth/me')
      if (data) return { state: 'ok', me: data }
      const p = error as Problem
      if (response.status === 401 && p?.code === 'setup_required') return { state: 'setup_required' }
      if (response.status === 401) return { state: 'unauthenticated' }
      throw failure(error, response)
    },
  })
}

function useAuthMutation<V>(call: (v: V) => Promise<{ error?: unknown; response: Response }>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: V) => {
      const { error, response } = await call(v)
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => qc.resetQueries(),
  })
}

export const useCreateAccount = () =>
  useAuthMutation((body: { username: string; password: string }) => api.POST('/setup/account', { body }))

export const useLogin = () => useAuthMutation((body: { username: string; password: string }) => api.POST('/auth/login', { body }))

export const useLogout = () => useAuthMutation(() => api.POST('/auth/logout'))

export const useLogoutEverywhere = () => useAuthMutation(() => api.POST('/auth/logout-everywhere'))

export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: { current_password: string; new_password: string }) => {
      const { error, response } = await api.POST('/account/password', { body })
      if (!response.ok) throw failure(error, response)
    },
  })
}

export type ReverseProxy = components['schemas']['ReverseProxy']
export type ReverseProxySettings = components['schemas']['ReverseProxySettings']

export function useApiKey() {
  return useQuery({
    queryKey: ['api-key'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api-key')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Generates the key, or rotates it when one exists. The returned key is shown once and never again. */
export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/api-key')
      if (!data) throw failure(error, response)
      return data.key
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-key'] }),
  })
}

export function useReverseProxy() {
  return useQuery({
    queryKey: ['reverse-proxy'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/settings/reverse-proxy')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

export function useSaveReverseProxy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ReverseProxySettings) => {
      const { error, response } = await api.PUT('/settings/reverse-proxy', { body })
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reverse-proxy'] }),
  })
}

// ---- plugins ----

export type PluginManifest = components['schemas']['PluginManifest']
export type PluginField = components['schemas']['PluginField']
export type PluginInstance = components['schemas']['PluginInstance']
export type PluginOption = components['schemas']['PluginOption']
/** Settings by manifest field key; `null` clears a field and a secret left out is kept. */
export type PluginConfig = { [key: string]: unknown }

/** Every built-in plugin's manifest; the forms are drawn from these. */
export function usePlugins() {
  return useQuery({
    queryKey: ['plugins'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/plugins')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

export function usePluginInstances() {
  return useQuery({
    queryKey: ['plugin-instances'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/plugin-instances')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

/**
 * Saves the form: a PATCH when `instance` is given, otherwise a create. `name`,
 * `enabled` and `priority` are sent only when given (forms that manage several
 * instances); otherwise a create is named after the plugin.
 */
export function useSavePluginInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      pluginId: string
      name: string
      config: PluginConfig
      instance?: PluginInstance
      managed?: { name: string; enabled: boolean; priority: number }
    }) => {
      const res = v.instance
        ? await api.PATCH('/plugin-instances/{id}', { params: { path: { id: v.instance.id } }, body: { ...v.managed, config: v.config } })
        : await api.POST('/plugin-instances', { body: { plugin_id: v.pluginId, name: v.name, ...v.managed, config: v.config } })
      if (!res.data) throw failure(res.error, res.response)
      return res.data
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['plugin-instances'] }), qc.invalidateQueries({ queryKey: ['setup'] })]),
  })
}

export function useDeletePluginInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error, response } = await api.DELETE('/plugin-instances/{id}', { params: { path: { id } } })
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['plugin-instances'] }), qc.invalidateQueries({ queryKey: ['setup'] })]),
  })
}

/**
 * Tests the form as it stands and, when the connection works, fetches the live
 * choices of the manifest's `live` fields (SABnzbd's categories).
 */
export function useTestPlugin() {
  return useMutation({
    mutationFn: async (v: { manifest: PluginManifest; config: PluginConfig; instance?: PluginInstance }) => {
      const test = v.instance
        ? await api.POST('/plugin-instances/{id}/test', { params: { path: { id: v.instance.id } }, body: { config: v.config } })
        : await api.POST('/plugin-instances/test', { body: { plugin_id: v.manifest.id, config: v.config } })
      if (!test.data) throw failure(test.error, test.response)
      const options: Record<string, PluginOption[]> = {}
      if (test.data.ok) {
        for (const f of v.manifest.fields.filter((f) => f.live)) {
          const res = await api.POST('/plugins/{plugin_id}/options/{field}', {
            params: { path: { plugin_id: v.manifest.id, field: f.key } },
            body: { config: v.config, instance_id: v.instance?.id ?? null },
          })
          if (res.data) options[f.key] = res.data.items
        }
      }
      return { result: test.data, options }
    },
  })
}

// ---- Primary Language and Profiles ----

export type Settings = components['schemas']['Settings']
export type SettingsPatch = components['schemas']['SettingsPatch']
export type Profile = components['schemas']['Profile']
export type ProfilePatch = components['schemas']['ProfilePatch']

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/settings')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** A merge patch over the settings sections. Changing the Primary Language re-points the Profiles, so they refetch too. */
export function usePatchSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SettingsPatch) => {
      const { data, error, response } = await api.PATCH('/settings', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => Promise.all(['settings', 'profiles', 'setup', 'about', 'status', 'attention'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

/** "Update from TRaSH": loads the newest snapshot now. A rejected one is a 422 and the old one stays. */
export function useUpdateTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/trash/update')
      if (!data) throw failure(error, response)
      return data
    },
    // Success or not, the snapshot's age and any Warning may have changed.
    onSettled: () => Promise.all(['status', 'attention', 'settings'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/profiles')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

export function usePatchProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { key: string; patch: ProfilePatch }) => {
      const { data, error, response } = await api.PATCH('/profiles/{key}', {
        params: { path: { key: v.key as components['parameters']['ProfileKey'] } },
        body: v.patch,
      })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

// ---- Library: lookup and Titles ----

export type TitleRow = components['schemas']['TitleRow']
export type TitleDetail = components['schemas']['TitleDetail']
export type LookupResult = components['schemas']['LookupResult']
export type LookupDetail = components['schemas']['LookupDetail']
export type TitleCreate = components['schemas']['TitleCreate']

/** The whole Library as compact rows; the SPA filters it locally. */
export function useTitles() {
  return useQuery({
    queryKey: ['titles'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/titles', { params: { query: { limit: 10000 } } })
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

export function useTitle(id: number | null) {
  return useQuery({
    queryKey: ['titles', id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/titles/{id}', { params: { path: { id: id! } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** One search across both kinds in the add menu, best match first, with a "Did you mean …?" title when it differs a lot. */
export function useLookup(q: string) {
  return useQuery({
    queryKey: ['lookup', q],
    enabled: q.trim().length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/lookup', { params: { query: { q } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** A search result with the Slots and Profiles the add panel preselects. */
export function useLookupDetail(kind: LookupResult['kind'], tmdbId: number) {
  return useQuery({
    queryKey: ['lookup', kind, tmdbId],
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/lookup/{kind}/{tmdb_id}', { params: { path: { kind, tmdb_id: tmdbId } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/**
 * A Series' overview from TheTVDB, loaded apart from the lookup so the add
 * panel never waits for it; null for a Series TheTVDB does not have.
 */
export function useSeriesOverview(tmdbId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['lookup', 'series', tmdbId, 'overview'],
    retry: false,
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/lookup/series/{tmdb_id}/overview', { params: { path: { tmdb_id: tmdbId } } })
      if (data) return data
      const err = failure(error, response)
      if (err.code === 'not_on_tvdb') return null
      throw err
    },
  })
}

export function useCreateTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: TitleCreate) => {
      const { data, error, response } = await api.POST('/titles', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['titles'] }), qc.invalidateQueries({ queryKey: ['lookup'] })]),
  })
}

// ---- Library: Series monitoring and the episode heat map ----

export type Episode = components['schemas']['Episode']
export type SeriesMonitor = components['schemas']['SeriesMonitor']
/**
 * Narrows work on a Series Version (Search now, Manual search, deleting files)
 * to a season and, within it, episodes; none is the whole Series.
 */
export type EpisodeScope = { season?: number; episode_ids?: number[] }

/** A Series' episodes with one cell per Version. */
export function useEpisodes(titleId: number, enabled = true) {
  return useQuery({
    queryKey: ['titles', titleId, 'episodes'],
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/titles/{id}/episodes', { params: { path: { id: titleId } } })
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

/** Runs a monitoring change on a Title, then reloads it, a Series' episodes and the list. */
function useMonitorMutation<V>(run: (v: V) => Promise<{ error?: unknown; response: Response }>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: V) => {
      const { error, response } = await run(v)
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  })
}

export const usePatchSeason = (titleId: number) =>
  useMonitorMutation(({ season, monitored }: { season: number; monitored: boolean }) =>
    api.PATCH('/titles/{id}/seasons/{season}', { params: { path: { id: titleId, season } }, body: { monitored } }),
  )

export const useMonitorEpisodes = (titleId: number) =>
  useMonitorMutation(({ ids, monitored }: { ids: number[]; monitored: boolean }) =>
    api.POST('/titles/{id}/episodes/monitor', { params: { path: { id: titleId } }, body: { episode_ids: ids, monitored } }),
  )


// ---- setup progress ----

/** Where each wizard section stands. */
export function useSetup(enabled = true) {
  return useQuery({
    queryKey: ['setup'],
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/setup')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Finishes setup; a 422 carries the missing sections as `fields`. */
export function useCompleteSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/setup/complete')
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup'] }),
  })
}

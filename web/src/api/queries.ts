import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

export type Me = components['schemas']['Me']

/** What the server says about this browser: no account yet, not logged in, or logged in. */
export type Auth = { state: 'setup_required' } | { state: 'unauthenticated' } | { state: 'ok'; me: Me }

/** A failed call, carrying the server's stable problem code and, for 429, the wait in seconds. */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
  }
}

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  const retry = Number(response.headers.get('Retry-After'))
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed', retry > 0 ? retry : undefined)
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

// ---- plugins ----

export type PluginManifest = components['schemas']['PluginManifest']
export type PluginField = components['schemas']['PluginField']
export type PluginInstance = components['schemas']['PluginInstance']
export type PluginOption = components['schemas']['PluginOption']
export type PluginTestResult = components['schemas']['PluginTestResult']
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

/** Saves the form: a PATCH when `instance` is given, otherwise a create. */
export function useSavePluginInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { pluginId: string; name: string; config: PluginConfig; instance?: PluginInstance }) => {
      const res = v.instance
        ? await api.PATCH('/plugin-instances/{id}', { params: { path: { id: v.instance.id } }, body: { config: v.config } })
        : await api.POST('/plugin-instances', { body: { plugin_id: v.pluginId, name: v.name, config: v.config } })
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

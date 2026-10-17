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

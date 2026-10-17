// Needs attention and the health strip: GET /attention, GET /system/status, and the
// actions the server builds for each row.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiBaseUrl } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type Attention = components['schemas']['Attention']
export type AttentionRow = components['schemas']['AttentionRow']
export type AttentionAction = components['schemas']['AttentionAction']
export type SystemStatus = components['schemas']['SystemStatus']

/** Kept live by the stream: an `attention` frame or hint invalidates this (live/stream.ts). */
export function useAttention() {
  return useQuery({
    queryKey: ['attention'],
    queryFn: async () => {
      const { data, error } = await api.GET('/attention')
      if (!data) throw error
      return data
    },
  })
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const { data, error } = await api.GET('/system/status')
      if (!data) throw error
      return data
    },
  })
}

/** What an action answered: a plugin test reports `message`, most others answer 204. */
export type ActionResult = { message: string | null; ok: boolean }

/**
 * Runs an API action the server built. The path is relative to the API root and
 * the server decides everything about the call, so the SPA needs no code per kind of row.
 * GET actions are not API calls; they open an SPA path (see `Shell`).
 */
export function useRunAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: AttentionAction): Promise<ActionResult> => {
      const res = await fetch(`${apiBaseUrl}${a.path}`, {
        method: a.method,
        headers: { 'Content-Type': 'application/json' },
        body: a.body ? JSON.stringify(a.body) : undefined,
      })
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { code?: string; detail?: string }
        throw new ApiError(p.code ?? 'internal', res.status, p.detail ?? 'The action failed')
      }
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      return { message: body?.message ?? null, ok: body?.ok ?? true }
    },
    // An action can change anything the screen shows; refetch the lot.
    onSettled: () => qc.invalidateQueries(),
  })
}

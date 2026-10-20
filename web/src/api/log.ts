// The Log (GET /events) and the Blocklist (GET/DELETE /blocklist). The stream's `log` and
// `blocklist` hints invalidate these keys (live/stream.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type LogEvent = components['schemas']['Event']
export type LogFilter = { kind: string; slot: string; titleId: number | null; routine: boolean }

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

export function useEvents(f: LogFilter) {
  return useQuery({
    queryKey: ['log', f],
    queryFn: async () => {
      const query = {
        ...(f.kind && { kind: f.kind }),
        ...(f.slot && { slot: f.slot as components['schemas']['Slot'] }),
        ...(f.titleId && { title_id: f.titleId }),
        ...(f.routine && { routine: true }),
      }
      const { data, error, response } = await api.GET('/events', { params: { query } })
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

export function useBlocklist() {
  return useQuery({
    queryKey: ['blocklist'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/blocklist')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

export function useUnblock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error, response } = await api.DELETE('/blocklist/{id}', { params: { path: { id } } })
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocklist'] }),
  })
}

// The Log (GET /events) and the Blocklist (GET/DELETE /blocklist). The stream's `log` and
// `blocklist` hints invalidate these keys (live/stream.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type LogEvent = components['schemas']['Event']
type Slot = components['schemas']['Slot']

/** What GET /events is asked for. A null list is no filter; an empty one matches nothing. */
export type LogFilter = {
  kinds: string[] | null
  excludeKinds: string[]
  slots: Slot[] | null
  excludeSlots: Slot[]
  titleIds: number[] | null
  excludeTitleIds: number[]
  routine: boolean
}

const matchesNothing = (f: LogFilter) => [f.kinds, f.slots, f.titleIds].some((l) => l?.length === 0)

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

/** The Log for `f`; `enabled` false waits, such as for the Titles a `title:` filter names. */
export function useEvents(f: LogFilter, enabled = true) {
  return useQuery({
    queryKey: ['log', f],
    enabled,
    queryFn: async () => {
      if (matchesNothing(f)) return []
      const query = {
        ...(f.kinds && { kind: f.kinds }),
        ...(f.excludeKinds.length > 0 && { exclude_kind: f.excludeKinds }),
        ...(f.slots && { slot: f.slots }),
        ...(f.excludeSlots.length > 0 && { exclude_slot: f.excludeSlots }),
        ...(f.titleIds && { title_id: f.titleIds }),
        ...(f.excludeTitleIds.length > 0 && { exclude_title_id: f.excludeTitleIds }),
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

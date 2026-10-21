// Activity's reads and actions beyond the queue: GET /grabs (stalled and finished Grabs),
// POST /grabs/{id}/retry-import and POST /grabs/{id}/discard, and the stream's `activity` frames.
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type GrabEntry = components['schemas']['GrabEntry']
type ActivitySnapshot = components['schemas']['ActivitySnapshot']

/**
 * The background work running now, as the stream's `activity` frames put it in the cache
 * (live/stream.ts). There is no GET for it: until the first frame it is undefined, and a
 * reconnect sends a fresh one.
 */
export function useActivity() {
  return useQuery<ActivitySnapshot>({ queryKey: ['activity'], queryFn: skipToken }).data
}

/** How far back Done and Failed reach; older Grabs are left to the Log. */
export const HISTORY_DAYS = 7

/** The most a stage list reads in one go. */
const PAGE = 500

/** Imported and failed Grabs of the last HISTORY_DAYS, newest first; `more` when the page could not hold them all. */
export function useFinishedGrabs() {
  return useQuery({
    queryKey: ['grabs', 'finished'],
    queryFn: async () => {
      const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
      const { data, error } = await api.GET('/grabs', { params: { query: { state: ['imported', 'failed'], since, limit: PAGE } } })
      if (!data) throw error
      return { items: data.items, more: data.next_cursor !== null }
    },
  })
}

/** Imports that wait for the environment, newest Grab first. */
export function useStalledGrabs() {
  return useQuery({
    queryKey: ['grabs', 'stalled'],
    queryFn: async () => {
      const { data, error } = await api.GET('/grabs', { params: { query: { stalled: true, limit: PAGE } } })
      if (!data) throw error
      return data.items
    },
  })
}

function problemOf(error: unknown, status: number, fallback: string) {
  const p = error as { code?: string; detail?: string } | undefined
  return new ApiError(p?.code ?? 'internal', status, p?.detail ?? fallback)
}

/** Retry a stalled Import now, or discard it (its files go and the Version is Wanted again). */
export function useStalledImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: 'retry' | 'discard' }) => {
      const path = action === 'retry' ? '/grabs/{id}/retry-import' : '/grabs/{id}/discard'
      const { error, response } = await api.POST(path, { params: { path: { id } } })
      if (!response.ok) throw problemOf(error, response.status, action === 'retry' ? 'Retry failed' : 'Discard failed')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grabs'] })
      void qc.invalidateQueries({ queryKey: ['attention'] })
    },
  })
}

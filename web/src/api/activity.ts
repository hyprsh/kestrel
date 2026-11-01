// Activity's reads and actions beyond the queue: GET /grabs (stalled and finished Grabs, the finished ones a page at a time) and its summary,
// POST /grabs/{id}/retry-import and POST /grabs/{id}/discard, and the stream's `activity` frames.
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type GrabEntry = components['schemas']['GrabEntry']
type ActivitySnapshot = components['schemas']['ActivitySnapshot']

/**
 * The background work running now, as the stream's `activity` frames put it in the cache
 * (live/stream.ts). The stream sends one on connect and on every reconnect, so this reads no
 * GET /activity: until the first frame it is undefined.
 */
export function useActivity() {
  return useQuery<ActivitySnapshot>({ queryKey: ['activity'], queryFn: skipToken }).data
}

/** The most a page of Done and Failed Grabs holds; more load as the list is scrolled. */
const PAGE = 50

/** What narrows the Grab history on the server: the filter's words, kinds, Slots and ids. */
export type GrabsFilter = { q: string; kind: string[] | null; slot: string[] | null; grab: number[] | null }

function filterQuery(f: GrabsFilter) {
  return {
    ...(f.q.trim() && { q: f.q.trim() }),
    ...(f.kind && { kind: f.kind as components['schemas']['TitleKind'][] }),
    ...(f.slot && { slot: f.slot as components['schemas']['Slot'][] }),
    ...(f.grab && { grab: f.grab }),
  }
}

/**
 * Imported and failed Grabs that pass `f`, newest first, a page at a time as far back as there are any.
 * `states` is the history stages shown; with none the query waits.
 */
export function useFinishedGrabs(f: GrabsFilter, states: readonly ('imported' | 'failed')[]) {
  return useInfiniteQuery({
    queryKey: ['grabs', 'finished', f, states],
    enabled: states.length > 0,
    initialPageParam: null as string | null,
    getNextPageParam: (last: components['schemas']['GrabList']) => last.next_cursor,
    queryFn: async ({ pageParam }) => {
      const query = { state: [...states], limit: PAGE, ...filterQuery(f), ...(pageParam && { cursor: pageParam }) }
      const { data, error } = await api.GET('/grabs', { params: { query } })
      if (!data) throw error
      return data
    },
  })
}

/** How many Done and Failed Grabs pass `f` over all the history, and when the oldest happened. */
export function useGrabsSummary(f: GrabsFilter) {
  return useQuery({
    queryKey: ['grabs', 'summary', f],
    queryFn: async () => {
      const { data, error } = await api.GET('/grabs/summary', { params: { query: filterQuery(f) } })
      if (!data) throw error
      return data
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

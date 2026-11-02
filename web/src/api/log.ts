// The Log (GET /events) and the Blocklist (GET/DELETE /blocklist). The stream's `log` and
// `blocklist` hints invalidate these keys (live/stream.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type LogEvent = components['schemas']['Event']
type Slot = components['schemas']['SlotId']

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

/** How many events one request for the Log asks for; fewer back means there are no more. */
export const EVENTS_PAGE = 200

/** One request for the Log for `f`: the newest events, or those before the event with id `before`. */
export async function fetchEvents(f: LogFilter, before?: number): Promise<LogEvent[]> {
  if (matchesNothing(f)) return []
  const query = {
    ...(f.kinds && { kind: f.kinds }),
    ...(f.excludeKinds.length > 0 && { exclude_kind: f.excludeKinds }),
    ...(f.slots && { slot: f.slots }),
    ...(f.excludeSlots.length > 0 && { exclude_slot: f.excludeSlots }),
    ...(f.titleIds && { title_id: f.titleIds }),
    ...(f.excludeTitleIds.length > 0 && { exclude_title_id: f.excludeTitleIds }),
    ...(f.routine && { routine: true }),
    ...(before !== undefined && { before }),
    limit: EVENTS_PAGE,
  }
  const { data, error, response } = await api.GET('/events', { params: { query } })
  if (!data) throw failure(error, response)
  return data.items
}

/** The newest events for `f`; `enabled` false waits, such as for the Titles a `title:` filter names. The stream's `log` hint refetches it. */
export function useEvents(f: LogFilter, enabled = true) {
  return useQuery({ queryKey: ['log', f], enabled, queryFn: () => fetchEvents(f) })
}

/** The earlier events of the same kind as an opened error, to say whether it happened before. Off until `kind` is known. */
export function useSameKind(kind: string | undefined) {
  return useQuery({
    queryKey: ['log', 'same', kind],
    enabled: kind !== undefined,
    queryFn: () => fetchEvents({ kinds: [kind!], excludeKinds: [], slots: null, excludeSlots: [], titleIds: null, excludeTitleIds: [], routine: false }),
  })
}

export type EventsHistogram = components['schemas']['EventsHistogram']

/** Events per 4 hours over the last `days` days, by severity (GET /events/histogram), for the Log's strip. */
export function useEventsHistogram(days: number) {
  return useQuery({
    queryKey: ['log', 'histogram', days],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/events/histogram', { params: { query: { bucket: '4h', days } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** The Grab an opened Log event is about, and its steps: Release, indexer, Score, Custom Formats, who chose it and where it stands now. */
export function useGrabOfEvent(id: number | null) {
  const grab = useQuery({
    queryKey: ['grabs', 'one', id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/grabs/{id}', { params: { path: { id: id! } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
  const steps = useQuery({
    queryKey: ['grabs', 'steps', id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/grabs/{id}/steps', { params: { path: { id: id! } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
  return { grab: grab.data, steps: steps.data }
}

export type EventsSummary = components['schemas']['EventsSummary']

/** What the Log holds: events per kind, the oldest one's time and how long routine events are kept (GET /events/summary). */
export function useEventsSummary() {
  return useQuery({
    queryKey: ['log', 'summary'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/events/summary')
      if (!data) throw failure(error, response)
      return data
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

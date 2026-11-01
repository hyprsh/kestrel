// Upcoming (GET /upcoming) and Recently added (GET /recent). Both sit under the ['titles']
// key, so the stream's `title` hints refetch them when an Import or an edit lands.
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from './client'
import type { components } from './schema.gen'

type RawItem = components['schemas']['UpcomingItem']
type Added = 'has_poster' | 'network' | 'overview' | 'air_at' | 'markers' | 'slots' | 'searchable' | 'dates' | 'episode_id' | 'monitored'
/** An entry with everything the API added to it after its first version, which every answer carries now. */
export type UpcomingItem = Omit<RawItem, Added> & Required<Pick<RawItem, Added>>
export type UndatedItem = components['schemas']['UndatedItem']
export type UpcomingSlot = components['schemas']['UpcomingSlot']

/** A local calendar day as YYYY-MM-DD, `plusDays` from today. */
export function dayString(plusDays = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + plusDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The local calendar day an entry falls on: where its air time lands in the browser's time zone (an
 * episode that airs at 21:00 in New York is on the next day's timeline in Berlin), else its date.
 */
export function localDay(item: Pick<UpcomingItem, 'date' | 'air_at'>): string {
  if (!item.air_at) return item.date
  return dayString(0, new Date(item.air_at))
}

// The added fields are optional in the spec, so an older answer still reads: with nothing known.
const filled = (i: RawItem): UpcomingItem => ({
  has_poster: false,
  network: null,
  overview: null,
  air_at: null,
  markers: [],
  slots: [],
  searchable: false,
  dates: [],
  episode_id: null,
  monitored: true,
  ...i,
})

async function fetchAgenda(from: string, to: string, unmonitored = false) {
  const { data, error } = await api.GET('/upcoming', { params: { query: { from, to, ...(unmonitored ? { unmonitored } : {}) } } })
  if (!data) throw error
  // The server orders by air date; air times can move an entry to another local day, so order again (stable).
  const items = data.items.map(filled).sort((a, b) => localDay(a).localeCompare(localDay(b)))
  return { items, undated: data.undated ?? [] }
}

/** The entries from today to `days` days on (both included). */
export function useUpcoming(days: number) {
  const from = dayString()
  const to = dayString(days)
  const q = useQuery({ queryKey: ['titles', 'upcoming', from, to], queryFn: () => fetchAgenda(from, to) })
  return { ...q, data: q.data?.items }
}

export type AgendaChunk = { from: string; to: string }

/**
 * The timeline as chunks (a month each, `to` included, unmonitored entries too), each its own query so a chunk is fetched once and the
 * others stay on screen while one loads. `items` are the chunks' entries in order, `undated` the Titles with no
 * date yet (the same in every answer), and `pending` and `counts` say per chunk whether it has not answered and how many entries it holds.
 */
export function useAgendaChunks(chunks: readonly AgendaChunk[]) {
  const results = useQueries({
    queries: chunks.map((c) => ({ queryKey: ['titles', 'upcoming', c.from, c.to, 'unmonitored'], queryFn: () => fetchAgenda(c.from, c.to, true) })),
  })
  const signature = results.map((r) => `${r.status}${r.dataUpdatedAt}`).join()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `results` is a new array on every render; the signature says when it changed
  return useMemo(() => {
    const seen = new Set<string>()
    const items: UpcomingItem[] = []
    for (const r of results) {
      for (const i of r.data?.items ?? []) {
        const key = `${i.date}|${i.kind}|${i.title_id}|${i.season ?? ''}|${i.episode ?? ''}|${i.release_type ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          items.push(i)
        }
      }
    }
    items.sort((a, b) => localDay(a).localeCompare(localDay(b)))
    return {
      items,
      undated: results.find((r) => r.data)?.data?.undated ?? [],
      pending: results.map((r) => r.isPending),
      counts: results.map((r) => r.data?.items.length ?? 0),
      anyData: results.some((r) => r.data),
      failed: results.some((r) => r.isError),
    }
  }, [signature])
}

export function useRecent() {
  return useQuery({
    queryKey: ['titles', 'recent'],
    queryFn: async () => {
      const { data, error } = await api.GET('/recent')
      if (!data) throw error
      return data
    },
  })
}

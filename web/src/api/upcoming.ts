// Upcoming (GET /upcoming) and Recently added (GET /recent). Both sit under the ['titles']
// key, so the stream's `title` hints refetch them when an Import or an edit lands.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

type RawItem = components['schemas']['UpcomingItem']
type Added = 'has_poster' | 'network' | 'overview' | 'air_at' | 'markers' | 'slots' | 'searchable' | 'dates' | 'episode_id'
/** An entry with everything the API added to it after its first version, which every answer carries now. */
export type UpcomingItem = Omit<RawItem, Added> & Required<Pick<RawItem, Added>>
export type UndatedItem = components['schemas']['UndatedItem']
export type UpcomingSlot = components['schemas']['UpcomingSlot']
export type RecentItem = components['schemas']['RecentItem']

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
  ...i,
})

function useAgenda(from: string, to: string, keep = false) {
  return useQuery({
    queryKey: ['titles', 'upcoming', from, to],
    placeholderData: keep ? keepPreviousData : undefined,
    queryFn: async () => {
      const { data, error } = await api.GET('/upcoming', { params: { query: { from, to } } })
      if (!data) throw error
      // The server orders by air date; air times can move an entry to another local day, so order again (stable).
      const items = data.items.map(filled).sort((a, b) => localDay(a).localeCompare(localDay(b)))
      return { items, undated: data.undated ?? [] }
    },
  })
}

/** The entries from today to `days` days on (both included). */
export function useUpcoming(days: number) {
  const q = useAgenda(dayString(), dayString(days))
  return { ...q, data: q.data?.items }
}

/**
 * The timeline: `back` days before today to `ahead` days after it, with the Titles that have no
 * date yet. Growing either keeps the entries on screen while the wider window loads.
 */
export function useTimeline(back: number, ahead: number) {
  return useAgenda(dayString(-back), dayString(ahead), true)
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

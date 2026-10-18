// Upcoming (GET /upcoming) and Recently added (GET /recent). Both sit under the ['titles']
// key, so the stream's `title` hints refetch them when an Import or an edit lands.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

export type UpcomingItem = components['schemas']['UpcomingItem']
export type RecentItem = components['schemas']['RecentItem']

/** A local calendar day as YYYY-MM-DD, `plusDays` from today. */
export function dayString(plusDays = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + plusDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The agenda from today to `days` days on (both included). */
export function useUpcoming(days: number) {
  const from = dayString()
  const to = dayString(days)
  return useQuery({
    queryKey: ['titles', 'upcoming', from, to],
    queryFn: async () => {
      const { data, error } = await api.GET('/upcoming', { params: { query: { from, to } } })
      if (!data) throw error
      return data.items
    },
  })
}

export function useRecent() {
  return useQuery({
    queryKey: ['titles', 'recent'],
    queryFn: async () => {
      const { data, error } = await api.GET('/recent')
      if (!data) throw error
      return data.items
    },
  })
}

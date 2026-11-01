// GET /stats: the Overview's dashboard figures for the last 7, 30 or 90 days.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

export type Stats = components['schemas']['Stats']
export type StatsRange = Stats['range']

/**
 * The statistics for a range. Changing the range keeps the previous answer on screen until the new one is in
 * (`isPlaceholderData`), so the charts dim instead of jumping.
 */
export function useStats(range: StatsRange) {
  return useQuery({
    queryKey: ['stats', range],
    queryFn: async () => {
      const { data, error } = await api.GET('/stats', { params: { query: { range } } })
      if (!data) throw error
      return data
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
}

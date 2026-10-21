// The search pipeline: GET /search/status, kept live by the stream's `search` frames.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema.gen'

export type SearchStatus = components['schemas']['SearchStatus']

/** Kept live by the stream's `search` snapshots (live/stream.ts); this fetch is the first paint and the fallback. */
export function useSearchStatus() {
  return useQuery({
    queryKey: ['search'],
    queryFn: async (): Promise<SearchStatus> => {
      const { data, error } = await api.GET('/search/status')
      if (!data) throw error
      return data
    },
  })
}

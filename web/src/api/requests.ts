// Requests from outside Kestrel (GET /requests). Their status is derived on read, so the
// stream's `title`, `grab` and `request` hints refetch every ['requests'] key (live/stream.ts);
// download progress between those comes from the live queue (requests/RequestRow.tsx).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type Request = components['schemas']['Request']

/** The newest five Requests and how many there are in all, for the Overview. */
export function useRecentRequests() {
  return useQuery({
    queryKey: ['requests', 'recent'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/requests', { params: { query: { limit: 5 } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

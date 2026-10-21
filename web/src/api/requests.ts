// Requests from outside Kestrel (GET /requests). Their status is derived on read, so the
// stream's `title`, `grab` and `request` hints refetch every ['requests'] key (live/stream.ts);
// download progress between those comes from the live queue (requests/RequestRow.tsx).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type Request = components['schemas']['Request']
type RequestList = components['schemas']['RequestList']
type State = 'open' | 'completed' | 'rejected'

/** What GET /requests is asked for. A null list is no filter; an empty one matches nothing. */
export type RequestFilter = { status: State[] | null; requester: string[] | null; source: string[] | null }

const PAGE = 50

/** Every Request matching `f`, newest first, a page at a time. */
export function useRequestList(f: RequestFilter) {
  return useInfiniteQuery({
    queryKey: ['requests', 'list', f],
    initialPageParam: null as string | null,
    getNextPageParam: (last: RequestList) => last.next_cursor,
    queryFn: async ({ pageParam }): Promise<RequestList> => {
      if ([f.status, f.requester, f.source].some((l) => l?.length === 0)) return { items: [], next_cursor: null, total: 0 }
      const query = {
        limit: PAGE,
        ...(pageParam && { cursor: pageParam }),
        ...(f.status && { status: f.status }),
        ...(f.requester && { requester: f.requester }),
        ...(f.source && { source: f.source }),
      }
      const { data, error, response } = await api.GET('/requests', { params: { query } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

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

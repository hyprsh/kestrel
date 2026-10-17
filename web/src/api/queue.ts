// Downloading now: GET /queue and POST /grabs/{id}/cancel.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type QueueItem = components['schemas']['QueueItem']

/** How often the list refreshes while Overview is open; the live stream replaces this later. */
const REFRESH_MS = 5000

export function useQueue() {
  return useQuery({
    queryKey: ['queue'],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await api.GET('/queue')
      if (!data) throw error
      return data.items
    },
  })
}

/** Cancel a Grab; with `blocklist` the Release is also blocklisted and the next best one searched. */
export function useCancelGrab() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, blocklist }: { id: number; blocklist: boolean }) => {
      const { error, response } = await api.POST('/grabs/{id}/cancel', { params: { path: { id } }, body: { blocklist } })
      if (error) {
        const p = error as { code?: string; detail?: string }
        throw new ApiError(p.code ?? 'internal', response.status, p.detail ?? 'Cancel failed')
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  })
}

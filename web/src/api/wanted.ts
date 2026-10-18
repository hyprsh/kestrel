// "Search all Wanted": POST /wanted/search queues every Wanted Version for a search now.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'

/** Resolves to how many Versions were queued. */
export function useSearchAllWanted() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/wanted/search')
      if (!data) {
        const p = error as { code?: string; detail?: string } | undefined
        throw new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? 'Request failed')
      }
      return data.versions
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  })
}

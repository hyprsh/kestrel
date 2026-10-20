// One Title's metadata actions: POST /titles/{id}/refresh and PATCH /titles/{id} with metadata_frozen.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'

/** Starts a metadata refresh; the Title changes when it is done, which the live stream reports. */
export function useRefreshTitle(titleId: number) {
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/titles/{id}/refresh', { params: { path: { id: titleId } } })
      if (!response.ok) throw failure(error, response)
    },
  })
}

/** Freezes or unfreezes a Title's metadata: a frozen Title is never refreshed. */
export function useSetFrozen(titleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (frozen: boolean) => {
      const { data, error, response } = await api.PATCH('/titles/{id}', { params: { path: { id: titleId } }, body: { metadata_frozen: frozen } })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  })
}

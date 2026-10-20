// Move a Title to another Root folder: PATCH /titles/{id} with root_folder.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'

export function useMoveTitle(titleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rootFolder: string) => {
      const { data, error, response } = await api.PATCH('/titles/{id}', { params: { path: { id: titleId } }, body: { root_folder: rootFolder } })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  })
}

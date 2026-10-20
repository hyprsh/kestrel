// POST /titles/bulk: one action over many Titles, answered per Title.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type TitlesBulk = components['schemas']['TitlesBulk']
export type TitleBulkOutcome = components['schemas']['TitleBulkOutcome']
export type TitleBulkReason = NonNullable<TitleBulkOutcome['reason']>

export function useBulkTitles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: TitlesBulk) => {
      const { data, error, response } = await api.POST('/titles/bulk', { body })
      if (!data) throw failure(error, response)
      return data.items
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['titles'] }), qc.invalidateQueries({ queryKey: ['releases'] })]),
  })
}

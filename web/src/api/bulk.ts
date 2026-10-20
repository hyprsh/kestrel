// POST /titles/bulk: one action over many Titles, answered per Title.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type TitlesBulk = components['schemas']['TitlesBulk']
export type TitleBulkOutcome = components['schemas']['TitleBulkOutcome']

type Problem = { code?: string; detail?: string; title?: string } | undefined

export function useBulkTitles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: TitlesBulk) => {
      const { data, error, response } = await api.POST('/titles/bulk', { body })
      if (!data) {
        const p = error as Problem
        throw new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
      }
      return data.items
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['titles'] }), qc.invalidateQueries({ queryKey: ['releases'] })]),
  })
}

// Watch-ahead for Silo: the Settings card's calls.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type Silo = components['schemas']['Silo']
export type SiloSettings = components['schemas']['SiloSettings']

export function useSiloSettings() {
  return useQuery({
    queryKey: ['silo-settings'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/settings/silo')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

export function useSaveSiloSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SiloSettings) => {
      const { data, error, response } = await api.PUT('/settings/silo', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['silo-settings'] }),
  })
}

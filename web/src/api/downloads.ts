// Settings' Downloads and Profiles pages: the download client's live status, the Grabs per indexer, a saved instance's Test
// and the Profiles' details.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type ProfileDetail = components['schemas']['ProfileDetail']
export type ProfileScoring = components['schemas']['ProfileScoring']
export type PluginTestResult = components['schemas']['PluginTestResult']

/** The enabled download client, asked now (version, queue, free space), and the Grabs of each indexer in the last 30 days. */
export function useDownloadsStatus() {
  return useQuery({
    queryKey: ['downloads-status'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/settings/downloads')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** What each Profile accepts and what uses it. */
export function useProfileDetails() {
  return useQuery({
    queryKey: ['profile-details'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/profiles/details')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

/** Tests a saved instance with its own settings, which counts as a check of it: its row, its latency and Health follow. */
export function useTestInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<PluginTestResult> => {
      const { data, error, response } = await api.POST('/plugin-instances/{id}/test', { params: { path: { id } }, body: {} })
      if (!data) throw failure(error, response)
      return data
    },
    onSettled: () => Promise.all(['plugin-instances', 'downloads-status', 'status', 'attention'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

/** Gives the indexers `ids` the priorities 1, 2, 3 … in that order: the order Kestrel asks them in. */
export function useReorderInstances() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: number; priority: number }[]) => {
      for (const { id, priority } of v) {
        const { data, error, response } = await api.PATCH('/plugin-instances/{id}', { params: { path: { id } }, body: { priority } })
        if (!data) throw failure(error, response)
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plugin-instances'] }),
  })
}

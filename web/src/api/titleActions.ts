// One Title's actions: POST /titles/{id}/refresh, and every PATCH /titles/{id}
// (monitoring, frozen metadata, the Root folder).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure, type SeriesMonitor } from './queries'
import type { components } from './schema.gen'

type TitlePatch = components['schemas']['TitlePatch']

/** Starts a metadata refresh; the Title changes when it is done, which the live stream reports. */
export function useRefreshTitle(titleId: number) {
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/titles/{id}/refresh', { params: { path: { id: titleId } } })
      if (!response.ok) throw failure(error, response)
    },
  })
}

/** PATCH /titles/{id} with the body `patch` makes of the value, then reloads the Title, a Series' episodes and the list. */
function usePatchTitle<V>(titleId: number, patch: (v: V) => TitlePatch) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: V) => {
      const { data, error, response } = await api.PATCH('/titles/{id}', { params: { path: { id: titleId } }, body: patch(v) })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['titles'] }),
  })
}

/** Monitors or unmonitors a Movie; a Series uses its monitoring mode instead. */
export const useSetMovieMonitored = (titleId: number) => usePatchTitle(titleId, (monitored: boolean) => ({ monitored }))

/** Sets a Series' monitoring mode. */
export const useSetSeriesMonitor = (titleId: number) => usePatchTitle(titleId, (mode: SeriesMonitor) => ({ series_monitor: mode }))

/** Freezes or unfreezes a Title's metadata: a frozen Title is never refreshed. */
export const useSetFrozen = (titleId: number) => usePatchTitle(titleId, (frozen: boolean) => ({ metadata_frozen: frozen }))

/** Moves a Title to another of its kind's Root folders. */
export const useMoveTitle = (titleId: number) => usePatchTitle(titleId, (rootFolder: string) => ({ root_folder: rootFolder }))

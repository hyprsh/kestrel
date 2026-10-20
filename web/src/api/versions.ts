// Manage Versions: POST /titles/{id}/versions, PATCH and DELETE /versions/{id}, DELETE /titles/{id}.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError, type EpisodeScope } from './queries'
import type { components } from './schema.gen'

export type VersionRef = components['schemas']['VersionRef']

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

function useChanged<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['titles'] }), qc.invalidateQueries({ queryKey: ['releases'] })]),
  })
}

export function useAddVersion(titleId: number) {
  return useChanged(async (body: VersionRef) => {
    const { data, error, response } = await api.POST('/titles/{id}/versions', { params: { path: { id: titleId } }, body })
    if (!data) throw failure(error, response)
    return data
  })
}

export function useSwitchProfile(versionId: number) {
  return useChanged(async (profile: string) => {
    const { data, error, response } = await api.PATCH('/versions/{id}', { params: { path: { id: versionId } }, body: { profile } })
    if (!data) throw failure(error, response)
    return data
  })
}

export function useRemoveVersion(versionId: number) {
  return useChanged(async (deleteFiles: boolean) => {
    const { error, response } = await api.DELETE('/versions/{id}', { params: { path: { id: versionId }, query: { delete_files: deleteFiles } } })
    if (!response.ok) throw failure(error, response)
  })
}

export function useRemoveTitle(titleId: number) {
  return useChanged(async (deleteFiles: boolean) => {
    const { error, response } = await api.DELETE('/titles/{id}', { params: { path: { id: titleId }, query: { delete_files: deleteFiles } } })
    if (!response.ok) throw failure(error, response)
  })
}

export type DeletedFiles = components['schemas']['DeletedFiles']

/** Deletes files of a Version and keeps it (DELETE /versions/{id}/files); `blocklist` also blocklists their Releases. */
export function useDeleteFiles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId, scope, blocklist }: { versionId: number; scope?: EpisodeScope; blocklist: boolean }): Promise<DeletedFiles> => {
      const query = { ...scope, ...(blocklist ? { blocklist } : {}) }
      const { data, error, response } = await api.DELETE('/versions/{id}/files', { params: { path: { id: versionId }, query } })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['titles'] }), qc.invalidateQueries({ queryKey: ['blocklist'] })]),
  })
}

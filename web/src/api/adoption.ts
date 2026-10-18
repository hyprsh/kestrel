// Adoption: GET /adoption, POST /adoption/scan, the plan's rows, PATCH a row and POST /adoption/commit.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type Adoption = components['schemas']['Adoption']
export type AdoptionRow = components['schemas']['AdoptionRow']
export type AdoptionFile = components['schemas']['AdoptionFile']
export type AdoptionRowPatch = components['schemas']['AdoptionRowPatch']

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

/** The plan's state. It polls while a scan or a commit runs; the stream's `adoption` hint refreshes it otherwise. */
export function useAdoption() {
  return useQuery({
    queryKey: ['adoption'],
    refetchInterval: (q) => (q.state.data?.state === 'scanning' || q.state.data?.state === 'committing' ? 1000 : false),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/adoption')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Every row of the plan, in the server's Matched, Needs choice, Skipped order. */
export function useAdoptionRows(enabled: boolean) {
  return useQuery({
    queryKey: ['adoption', 'rows'],
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/adoption/rows')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

function useAdoptionMutation<V>(run: (v: V) => Promise<void>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adoption'] }),
  })
}

export function useScan() {
  return useAdoptionMutation<void>(async () => {
    const { error, response } = await api.POST('/adoption/scan', { body: {} })
    if (error) throw failure(error, response)
  })
}

export function usePatchRow() {
  return useAdoptionMutation<{ id: number; patch: AdoptionRowPatch }>(async ({ id, patch }) => {
    const { error, response } = await api.PATCH('/adoption/rows/{id}', { params: { path: { id } }, body: patch })
    if (error) throw failure(error, response)
  })
}

export function useCommit() {
  return useAdoptionMutation<number>(async (revision) => {
    const { error, response } = await api.POST('/adoption/commit', { body: { revision } })
    if (error) throw failure(error, response)
  })
}

export function useDiscard() {
  return useAdoptionMutation<void>(async () => {
    const { error, response } = await api.DELETE('/adoption')
    if (error) throw failure(error, response)
  })
}

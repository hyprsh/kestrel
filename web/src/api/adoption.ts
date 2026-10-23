// Adoption: GET /adoption, POST /adoption/scan, PATCH /adoption (how its Titles are monitored), the plan's rows
// (a page at a time), PATCH a row, bulk edits of rows and POST /adoption/commit.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type Adoption = components['schemas']['Adoption']
export type AdoptionRow = components['schemas']['AdoptionRow']
export type AdoptionFile = components['schemas']['AdoptionFile']
export type AdoptionRowPatch = components['schemas']['AdoptionRowPatch']
export type AdoptionRowsBulk = components['schemas']['AdoptionRowsBulk']
export type AdoptionBulkRowResult = components['schemas']['AdoptionBulkRowResult']
export type AdoptionBulkResult = components['schemas']['AdoptionBulkResult']
export type AdoptionOutcome = components['schemas']['AdoptionFinalOutcome']
export type AdoptionOutcomes = components['schemas']['AdoptionOutcomes']
/** The entry a running scan or commit is working on. */
export type AdoptionCurrent = components['schemas']['AdoptionCurrent']
/** How an Adoption adds a Title: monitored, a Series from its future episodes on, or unmonitored. */
export type AdoptionMonitor = components['schemas']['AdoptionMonitor']
type AdoptionRowList = components['schemas']['AdoptionRowList']
/** The filters the rows can be asked for; `all` is every row. */
export type AdoptionFilter = components['schemas']['AdoptionRowFilter']

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

const PAGE = 100

/**
 * The plan's rows a page at a time, in the server's Matched, Needs choice, Skipped order: the rows under review
 * that `filter` keeps, or, with `outcome`, the rows a finished commit kept that ended that way.
 */
export function useAdoptionRows({ filter = 'all', outcome }: { filter?: AdoptionFilter; outcome?: AdoptionOutcome }, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['adoption', 'rows', filter, outcome ?? 'plan'],
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last: AdoptionRowList) => last.next_cursor,
    queryFn: async ({ pageParam }): Promise<AdoptionRowList> => {
      const query = { limit: PAGE, ...(filter !== 'all' && { filter }), ...(outcome && { outcome }), ...(pageParam && { cursor: pageParam }) }
      const { data, error, response } = await api.GET('/adoption/rows', { params: { query } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** A plan exists: scanning, waiting for review or committing. */
export const planWaiting = (state: components['schemas']['Adoption']['state'] | undefined) => state !== undefined && state !== 'idle'

/** What the Settings button and the command menu say: a new scan replaces a stored plan, so a plan reads as one to review. */
export const adoptionLabel = (state: components['schemas']['Adoption']['state'] | undefined) =>
  planWaiting(state) ? 'Review the Adoption plan' : 'Scan for unmanaged files'

function useAdoptionMutation<V, R = void>(run: (v: V) => Promise<R>) {
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

/** Chooses how the Titles the plan adds are monitored, unless a row has its own choice. */
export function usePatchPlan() {
  return useAdoptionMutation<AdoptionMonitor>(async (monitor) => {
    const { error, response } = await api.PATCH('/adoption', { body: { monitor } })
    if (error) throw failure(error, response)
  })
}

export function usePatchRow() {
  return useAdoptionMutation<{ id: number; patch: AdoptionRowPatch }>(async ({ id, patch }) => {
    const { error, response } = await api.PATCH('/adoption/rows/{id}', { params: { path: { id } }, body: patch })
    if (error) throw failure(error, response)
  })
}

/** One action over many rows, by id or as every row of a filter; the answer says what happened to each. */
export function useBulkRows() {
  return useAdoptionMutation<AdoptionRowsBulk, AdoptionBulkResult>(async (body) => {
    const { data, error, response } = await api.POST('/adoption/rows/bulk', { body })
    if (!data) throw failure(error, response)
    return data
  })
}

export function useCommit() {
  return useAdoptionMutation<number>(async (revision) => {
    const { error, response } = await api.POST('/adoption/commit', { body: { revision } })
    if (error) throw failure(error, response)
  })
}

/** Plans the failed entries of the last commit again, without a new scan. */
export function useRetry() {
  return useAdoptionMutation<void>(async () => {
    const { error, response } = await api.POST('/adoption/retry')
    if (error) throw failure(error, response)
  })
}

/** Puts the entries a commit left Not chosen back in the plan to settle, without a scan. */
export function useReopen() {
  return useAdoptionMutation<void>(async () => {
    const { error, response } = await api.POST('/adoption/reopen')
    if (error) throw failure(error, response)
  })
}

export function useDiscard() {
  return useAdoptionMutation<void>(async () => {
    const { error, response } = await api.DELETE('/adoption')
    if (error) throw failure(error, response)
  })
}

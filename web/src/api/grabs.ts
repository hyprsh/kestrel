// Manual search, Search now and Grab: POST /versions/{id}/releases, POST /versions/{id}/search and POST /grabs.
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type Release = components['schemas']['Release']
export type Rejection = components['schemas']['Rejection']
export type ReleaseList = components['schemas']['ReleaseList']
export type IndexerError = components['schemas']['IndexerError']
export type Grab = components['schemas']['Grab']
export type GrabCreate = components['schemas']['GrabCreate']
/** Narrows a Series search to a season and, within it, episodes. */
export type ReleaseScope = components['schemas']['ReleaseSearch']

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  const retry = Number(response.headers.get('Retry-After'))
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed', retry > 0 ? retry : undefined)
}

/**
 * A manual search for a Version, of a Series narrowed by `scope`. The search is
 * a POST, so it runs once when the view opens and again only on `refetch()`:
 * never in the background.
 */
export function useReleases(versionId: number, scope?: ReleaseScope) {
  return useQuery({
    queryKey: ['releases', versionId, scope ?? null],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error, response } = await api.POST('/versions/{id}/releases', { params: { path: { id: versionId } }, body: scope })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

export function useGrab() {
  return useMutation({
    mutationFn: async (body: GrabCreate) => {
      const { data, error, response } = await api.POST('/grabs', { body })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/**
 * Search now: the automatic search for a Version (of a Series narrowed by
 * `scope`), started at once in the background. What it grabs reaches the
 * views through the live stream and shows in the Log.
 */
export function useSearchNow() {
  return useMutation({
    mutationFn: async ({ versionId, scope }: { versionId: number; scope?: ReleaseScope }) => {
      const { error, response } = await api.POST('/versions/{id}/search', { params: { path: { id: versionId } }, body: scope })
      if (!response.ok) throw failure(error, response)
    },
  })
}

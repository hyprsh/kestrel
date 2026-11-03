// Manual search, Search now and Grab: POST /versions/{id}/releases, POST /versions/{id}/search, POST /grabs and POST /blocklist.
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from './client'
import { ApiError } from './queries'
import type { EpisodeScope } from './queries'
import type { components } from './schema.gen'
import { watchSearchResult, type SearchWatch } from '../activity/searchResultToast'

export type Release = components['schemas']['Release']
export type GrabCreate = components['schemas']['GrabCreate']

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
export function useReleases(versionId: number, scope?: EpisodeScope) {
  // The first run lists the answer of a search from the last 30 min when there is one; every later run asks the indexers.
  const opened = useRef(false)
  return useQuery({
    queryKey: ['releases', versionId, scope ?? null],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const refresh = opened.current
      opened.current = true
      const { data, error, response } = await api.POST('/versions/{id}/releases', { params: { path: { id: versionId } }, body: refresh ? { ...scope, refresh } : scope })
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
 * Where a Grab stands (GET /grabs/{id}), for one made from a manual search that has left the live queue: finished, or failed.
 * The stream's `grab` hints refetch it. Off until `id` is known.
 */
export function useGrabStatus(id: number | undefined) {
  return useQuery({
    queryKey: ['grabs', 'one', id],
    enabled: id !== undefined,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/grabs/{id}', { params: { path: { id: id as number } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Blocklist a Release of a manual search for good, whatever Version it was found for. */
export function useBlocklistRelease() {
  return useMutation({
    mutationFn: async (body: components['schemas']['BlocklistCreate']) => {
      const { error, response } = await api.POST('/blocklist', { body })
      if (!response.ok) throw failure(error, response)
    },
  })
}

/**
 * Search now: the automatic search for a Version (of a Series narrowed by
 * `scope`), started at once in the background. With `upgrade` it searches the
 * filled episodes for a better Release instead; `started` is then false when
 * nothing in scope was left to upgrade (answered 200, not 202). What it grabs reaches the
 * views through the live stream and shows in the Log. `watch` asks for a Toast when the search ends.
 */
export function useSearchNow() {
  return useMutation({
    mutationFn: async ({ versionId, scope, upgrade, watch }: { versionId: number; scope?: EpisodeScope; upgrade?: boolean; watch?: SearchWatch }): Promise<{ started: boolean }> => {
      const { data, error, response } = await api.POST('/versions/{id}/search', { params: { path: { id: versionId } }, body: upgrade ? { ...scope, upgrade } : scope })
      if (!response.ok) throw failure(error, response)
      // With `watch`, a Toast says what the search found when the stream reports it done.
      if (watch && data?.search_id) watchSearchResult(data.search_id, watch)
      return { started: response.status !== 200 } // 200: an Upgrade search with nothing to upgrade
    },
  })
}

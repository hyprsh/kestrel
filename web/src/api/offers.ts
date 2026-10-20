// Original Offers: Releases with the Title's Original Language only that a Profile set to offer
// holds back. POST /versions/{id}/original-offer/accept and /dismiss.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type OriginalOffer = components['schemas']['OriginalOffer']
export type OriginalsAvailable = components['schemas']['OriginalsAvailable']

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

/** Accept grabs every Release of the offer, the same as "Grab anyway". */
export function useAcceptOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (versionId: number) => {
      const { data, error, response } = await api.POST('/versions/{id}/original-offer/accept', { params: { path: { id: versionId } } })
      if (!data) throw failure(error, response)
      return data
    },
    onSettled: () => qc.invalidateQueries(),
  })
}

/** Dismiss keeps waiting for a Primary-Language Release until a better original comes. */
export function useDismissOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (versionId: number) => {
      const { error, response } = await api.POST('/versions/{id}/original-offer/dismiss', { params: { path: { id: versionId } } })
      if (!response.ok) throw failure(error, response)
    },
    onSettled: () => qc.invalidateQueries(),
  })
}

/** What an offer holds, in a few words: the episodes and packs of a Series, nothing for a Movie. */
export function offerUnits(o: OriginalOffer): string | null {
  const parts: string[] = []
  for (const r of o.releases) {
    if (r.season === null) continue
    const s = String(r.season).padStart(2, '0')
    if (r.pack) parts.push(`S${s} pack`)
    else for (const e of r.episodes) parts.push(`S${s}E${String(e).padStart(2, '0')}`)
  }
  return parts.length ? parts.join(', ') : null
}

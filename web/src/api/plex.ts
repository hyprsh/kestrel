// Plex sign-in for Requesters: the login card's calls, the Settings card's, and the Requester's own Requests.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { Request } from './requests'
import type { components } from './schema.gen'

export type PlexSignIn = components['schemas']['PlexSignIn']
export type PlexSignInSettings = components['schemas']['PlexSignInSettings']
type RequestList = components['schemas']['RequestList']
type Kind = components['schemas']['TitleKind']

/** Whether the login card offers "Sign in with Plex". */
export function usePlexAvailable() {
  return useQuery({
    queryKey: ['auth-plex'],
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/auth/plex')
      if (!data) throw failure(error, response)
      return data.enabled
    },
  })
}

/** Starts a sign-in: the PIN cookie is set and the plex.tv page to send the browser to comes back. */
export function useStartPlexSignIn() {
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/auth/plex/pin')
      if (!data) throw failure(error, response)
      return data.auth_url
    },
  })
}

/** How long to wait between asking whether Plex has authorised the PIN, and how long to keep asking. */
const pollEveryMs = 1000
const pollForMs = 15_000

/**
 * Finishes a sign-in after Plex sent the browser back. Plex may not have recorded the
 * authorisation yet (`409 pending`), so it asks again about every second for about 15 s.
 * Resolves when the session is set; rejects with the server's ApiError, or the last `pending`.
 */
export function useFinishPlexSignIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const until = Date.now() + pollForMs
      try {
        for (;;) {
          const { error, response } = await api.POST('/auth/plex/login')
          if (response.ok) return
          const problem = failure(error, response)
          if (problem.code !== 'pending' || Date.now() >= until) throw problem
          await new Promise((resolve) => setTimeout(resolve, pollEveryMs))
        }
      } finally {
        // Success or not, the sign-in is over: a reload must not try to finish it again.
        const url = new URL(location.href)
        url.searchParams.delete('plex')
        history.replaceState(history.state, '', url)
      }
    },
    onSuccess: () => qc.resetQueries(),
  })
}

export function usePlexSignIn() {
  return useQuery({
    queryKey: ['plex-sign-in'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/settings/plex-sign-in')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

export function useSavePlexSignIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: PlexSignInSettings) => {
      const { data, error, response } = await api.PUT('/settings/plex-sign-in', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['plex-sign-in'] }), qc.invalidateQueries({ queryKey: ['auth-plex'] })]),
  })
}

const PAGE = 100

/** The signed-in Requester's own Requests, newest first, a page at a time. */
export function useMyRequests() {
  return useInfiniteQuery({
    queryKey: ['my-requests'],
    initialPageParam: null as string | null,
    getNextPageParam: (last: RequestList) => last.next_cursor,
    queryFn: async ({ pageParam }): Promise<RequestList> => {
      const { data, error, response } = await api.GET('/my/requests', { params: { query: { limit: PAGE, ...(pageParam && { cursor: pageParam }) } } })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Asks for a Title; the Requester's Requests and the lookup (which says what is in the Library) refetch. */
export function useMakeRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { kind: Kind; tmdb_id: number }): Promise<Request> => {
      const { data, error, response } = await api.POST('/my/requests', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['my-requests'] }), qc.invalidateQueries({ queryKey: ['lookup'] })]),
  })
}

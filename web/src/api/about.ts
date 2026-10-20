// About: GET /about and GET /about/notices.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export function useAbout() {
  return useQuery({
    queryKey: ['about'],
    queryFn: async () => {
      const { data, error } = await api.GET('/about')
      if (!data) throw error
      return data
    },
  })
}

/** The generated third-party notices, fetched only when the admin opens them. */
export function useNotices(enabled: boolean) {
  return useQuery({
    queryKey: ['about', 'notices'],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await api.GET('/about/notices', { parseAs: 'text' })
      if (data === undefined) throw error
      return data as string
    },
  })
}

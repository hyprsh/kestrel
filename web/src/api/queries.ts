import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export function useSystem() {
  return useQuery({
    queryKey: ['system'],
    queryFn: async () => {
      const { data, error } = await api.GET('/system')
      if (error) throw error
      return data
    },
  })
}

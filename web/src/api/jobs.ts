// The background jobs: GET /jobs, kept live by the stream's `jobs` frames, and Run now.
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type Job = components['schemas']['Job']

/** Kept live by the stream's `jobs` snapshots (live/stream.ts); this fetch is the first paint and the fallback. */
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: async (): Promise<{ items: Job[] }> => {
      const { data, error } = await api.GET('/jobs')
      if (!data) throw error
      return data
    },
  })
}

/** Kicks a loop; the next `jobs` frame shows it running. */
export function useRunJob() {
  return useMutation({
    mutationFn: async (name: string) => {
      const { error, response } = await api.POST('/jobs/{name}/run', { params: { path: { name } } })
      if (!response.ok) throw failure(error, response)
    },
  })
}

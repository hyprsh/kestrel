// Clean up: POST /cleanup/preview lists Unmanaged files by category, POST /cleanup/run deletes the ticked ones.
import { useMutation } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './queries'
import type { components } from './schema.gen'

export type CleanupPreview = components['schemas']['CleanupPreview']
export type CleanupCategory = components['schemas']['CleanupPreviewCategory']
export type CleanupResult = components['schemas']['CleanupResult']

type Problem = { code?: string; detail?: string; title?: string } | undefined

function failure(error: unknown, response: Response): ApiError {
  const p = error as Problem
  return new ApiError(p?.code ?? 'internal', response.status, p?.detail ?? p?.title ?? 'Request failed')
}

export function usePreviewCleanup() {
  return useMutation({
    mutationFn: async (titleId?: number) => {
      const { data, error, response } = await api.POST('/cleanup/preview', { body: titleId ? { title_id: titleId } : {} })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

export function useRunCleanup() {
  return useMutation({
    mutationFn: async (v: { previewId: string; categories: CleanupCategory['key'][]; exclude: string[] }) => {
      const { data, error, response } = await api.POST('/cleanup/run', {
        body: { preview_id: v.previewId, categories: v.categories, exclude: v.exclude },
      })
      if (!data) throw failure(error, response)
      return data
    },
  })
}

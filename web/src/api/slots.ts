// The Slots of the library (ADR 0024): one to four, in the admin's order, each with its label. Every screen that names a
// Slot reads them from here, so a rename shows everywhere at once: a change invalidates ['slots'] (a `title` hint does too).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type SlotRecord = components['schemas']['Slot']

export function useSlots() {
  return useQuery({
    queryKey: ['slots'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/slots')
      if (!data) throw failure(error, response)
      return data.items
    },
  })
}

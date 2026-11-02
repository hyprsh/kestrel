// The Slots (ADR 0024): GET/POST /slots, PATCH/DELETE /slots/{id}, the dry run that counts a rename's files, and the setup presets (ADR 0026).
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from './client'
import { failure } from './queries'
import type { components } from './schema.gen'

export type Slot = components['schemas']['Slot']
export type SlotCreate = components['schemas']['SlotCreate']
export type SlotPatch = components['schemas']['SlotPatch']
export type SlotPreset = components['schemas']['SlotPreset']

/** Slots are declared together: the Config File sets all of them or none. */
export const declaresSlots = (slots: readonly Slot[]) => slots.some((s) => s.from_config_file)

/** The Slots in order. */
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

/** A Slot changed, was made or went: the list, and the Library rows and settings that name it. */
const invalidateSlots = (qc: QueryClient) => Promise.all(['slots', 'settings', 'titles', 'setup'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

export function useCreateSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SlotCreate) => {
      const { data, error, response } = await api.POST('/slots', { body })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => invalidateSlots(qc),
  })
}

export function usePatchSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; patch: SlotPatch }) => {
      const { data, error, response } = await api.PATCH('/slots/{id}', { params: { path: { id: v.id } }, body: v.patch })
      if (!data) throw failure(error, response)
      return data
    },
    onSuccess: () => invalidateSlots(qc),
  })
}

export function useDeleteSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await api.DELETE('/slots/{id}', { params: { path: { id } } })
      if (!response.ok) throw failure(error, response)
    },
    onSuccess: () => invalidateSlots(qc),
  })
}

/** The setup wizard's Slot presets: none once the library holds a Version, or while the Config File declares the Slots. */
export function useSlotPresets() {
  return useQuery({
    queryKey: ['slot-presets'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/slots/presets')
      if (!data) throw failure(error, response)
      return data
    },
  })
}

/** Replaces the Slots with a preset's, and imports and enables its default Profiles: the Slots, Profiles and setup state all change. */
export function useApplySlotPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: SlotPreset['id']) => {
      const { data, error, response } = await api.POST('/slots/presets/{id}', { params: { path: { id } } })
      if (!data) throw failure(error, response)
      return data.items
    },
    onSuccess: () => Promise.all([invalidateSlots(qc), qc.invalidateQueries({ queryKey: ['profiles'] }), qc.invalidateQueries({ queryKey: ['slot-presets'] })]),
  })
}

/**
 * What saving `label` on a Slot would do, asked with `dry_run`: nothing is saved. It answers the files the rename
 * touches, or fails with the rule the label breaks (a 422 on `label`). Idle while `label` is the saved one.
 */
export function useRenamePreview(slot: Slot | undefined, label: string) {
  const asked = slot !== undefined && label !== slot.label
  return useQuery({
    queryKey: ['slot-dry-run', slot?.id, label], // not under ['slots']: a saved change must not ask the dry run again
    enabled: asked,
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const { data, error, response } = await api.PATCH('/slots/{id}', { params: { path: { id: slot!.id }, query: { dry_run: true } }, body: { label } })
      if (!data) throw failure(error, response)
      return data.renames_files ?? 0
    },
  })
}

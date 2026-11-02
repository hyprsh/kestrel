import type { components } from '../api/schema.gen'
import { http } from './handlers'
import { server } from './server'

type Slot = components['schemas']['Slot']

/** A Slot record as the server lists it. */
export const slotRecord = (id: string, label: string, position: number, over: Partial<Slot> = {}): Slot => ({
  id,
  label,
  default_movies: null,
  default_series: null,
  on_for_new_titles: position === 0,
  position,
  from_config_file: false,
  ...over,
})

/**
 * The library's Slots for the test, in order, as `[id, label]`. The returned function renames one for the next fetch,
 * as an admin's change would be.
 */
export function serveSlots(...slots: [id: string, label: string][]) {
  let list = slots.map(([id, label], i) => slotRecord(id, label, i))
  server.use(http.get('/slots', ({ response }) => response(200).json({ items: list })))
  return {
    rename: (id: string, label: string) => {
      list = list.map((s) => (s.id === id ? { ...s, label } : s))
    },
  }
}

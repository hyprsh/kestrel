// The `search_finished` frames of the stream: the end of a search the user started (Search now, Upgrade). They are not
// cached state. A tab that started a search watches its id (activity/searchResultToast.tsx); a frame that comes before
// the watch is registered (the answer to the POST and the frame race) waits here for it.
import type { components } from '../api/schema.gen'

export type SearchFinished = components['schemas']['SearchFinished']

const KEPT = 50
const recent: SearchFinished[] = []
const listeners = new Set<(f: SearchFinished) => void>()

/** A frame arrived from the stream (or from the tab that holds it). */
export function publishSearchFinished(f: SearchFinished) {
  recent.push(f)
  if (recent.length > KEPT) recent.shift()
  for (const l of [...listeners]) l(f)
}

/** Calls `fn` for each frame from now on. Returns the function that stops it. */
export function onSearchFinished(fn: (f: SearchFinished) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The frame of search `id` if it has already arrived, taken off the shelf. */
export function takeFinished(id: string): SearchFinished | undefined {
  const at = recent.findIndex((f) => f.search_id === id)
  return at < 0 ? undefined : recent.splice(at, 1)[0]
}

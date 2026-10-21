// What Kestrel is doing in the background right now, for the top bar's indicator and the
// Activity screen's "Running now": the loops mid-pass (ADR 0007) and an Adoption scan or
// commit, from the stream's `activity` frames.
import { useEffect, useReducer, useRef } from 'react'
import { useActivity } from '../api/activity'
import { useSearchStatus } from '../api/search'
import { jobWords } from './jobNames'

/** One piece of background work: `name` for a list, `short` for the top bar. */
export type Running = {
  key: string
  name: string
  short: string
  progress?: { done: number; total: number }
}

/** Many passes take milliseconds; only work running this long shows, so nothing flickers. */
const SETTLE_MS = 1000

/** The background work that has been running for over a second. */
export function useRunningNow(): Running[] {
  const activity = useActivity()
  const pass = useSearchStatus().data?.pass
  const all: Running[] = (activity?.running ?? []).map((name) => ({
    key: name,
    name: jobWords(name).running,
    short: jobWords(name).short,
    // The search pass counts the Versions it has got through (the `search` frame).
    ...(name === 'search' && pass ? { progress: { done: pass.done, total: pass.total } } : {}),
  }))
  const adoption = activity?.adoption
  if (adoption) {
    const name = adoption.state === 'scanning' ? 'Scanning for files to adopt' : 'Adopting files into the Library'
    all.unshift({ key: `adoption-${adoption.state}`, name, short: `${name}…`, progress: { done: adoption.done, total: adoption.total } })
  }
  return useSettled(all)
}

/**
 * The items that have been in the list for SETTLE_MS, re-rendering when the next one gets
 * there. An item counts from the render that first sees it.
 */
function useSettled<T extends { key: string }>(items: T[]): T[] {
  const seen = useRef(new Map<string, number>())
  const [, wake] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  const keys = new Set(items.map((i) => i.key))
  for (const key of seen.current.keys()) if (!keys.has(key)) seen.current.delete(key)
  for (const key of keys) if (!seen.current.has(key)) seen.current.set(key, now)
  const due = (i: T) => seen.current.get(i.key)! + SETTLE_MS
  const waiting = items.filter((i) => due(i) > now)
  const next = waiting.length ? Math.min(...waiting.map(due)) : null
  useEffect(() => {
    if (next === null) return
    const id = setTimeout(wake, next - Date.now())
    return () => clearTimeout(id)
  }, [next])
  return items.filter((i) => due(i) <= now)
}

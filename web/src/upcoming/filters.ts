// Upcoming's filter text. A session starts from the household's defaults (Settings > Display), written as a query
// (`kind:series is:wanted -is:imported`), and remembers what it changes (not on the server): leaving the screen and
// coming back finds the query as it was. An address with `?q=` wins over both.
import { useEffect, useRef } from 'react'
import { useDisplay, type Display } from '../display/useDisplay'

const key = 'kestrel.upcoming.query'

/** The stored query, or null when this session has not changed it. sessionStorage can be missing or throw (blocked storage). */
function load(): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function store(query: string) {
  try {
    sessionStorage.setItem(key, query)
  } catch {
    // not remembered
  }
}

/** The query Settings > Display names for a new session. */
function defaultQuery(d: Display['upcoming_filters']): string {
  return [d.kind === 'movie' || d.kind === 'series' ? `kind:${d.kind}` : '', d.wanted_only ? 'is:wanted' : '', d.hide_imported ? '-is:imported' : ''].filter(Boolean).join(' ')
}

/** Starts an empty query on the session's or the household's default once Display has loaded, and keeps the session's changes. */
export function useSeededQuery(query: string, onQuery: (query: string) => void) {
  const { display, ready } = useDisplay()
  const seeded = useRef(false)
  useEffect(() => {
    if (!ready || seeded.current) return
    seeded.current = true
    if (query !== '') return store(query)
    const start = load() ?? defaultQuery(display.upcoming_filters)
    if (start !== '') onQuery(start)
  }, [ready, query, display.upcoming_filters, onQuery])
  useEffect(() => {
    if (seeded.current) store(query)
  }, [query])
}

// The Upcoming filters. A session starts from the household's defaults (Settings > Display) and remembers
// what it changes (not on the server): leaving the screen and coming back finds them as they were.
import { useCallback, useMemo, useState } from 'react'
import { useDisplay, type Display } from '../display/useDisplay'
import type { Filters } from './state'

const key = 'kestrel.upcoming.filters'

/** The filters this browser session changed, or null when it has not: then the household's defaults stand. */
// sessionStorage can be missing or throw (blocked storage): then nothing is remembered.
function load(): Filters | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw === null) return null
    const v: Partial<Filters> = JSON.parse(raw)
    return {
      kind: v.kind === 'movie' || v.kind === 'series' ? v.kind : 'all',
      wantedOnly: v.wantedOnly === true,
      hideImported: v.hideImported === true,
    }
  } catch {
    return null
  }
}

/** The filters Settings > Display names for a new session. */
function defaults(d: Display['upcoming_filters']): Filters {
  return { kind: d.kind === 'movie' || d.kind === 'series' ? d.kind : 'all', wantedOnly: d.wanted_only, hideImported: d.hide_imported }
}

export function useUpcomingFilters(): [Filters, (change: Partial<Filters>) => void] {
  const { display } = useDisplay()
  const [picked, setPicked] = useState(load)
  const filters = useMemo(() => picked ?? defaults(display.upcoming_filters), [picked, display.upcoming_filters])
  const change = useCallback(
    (c: Partial<Filters>) => {
      const next = { ...filters, ...c }
      setPicked(next)
      try {
        sessionStorage.setItem(key, JSON.stringify(next))
      } catch {
        // not remembered
      }
    },
    [filters],
  )
  return [filters, change]
}

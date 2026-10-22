// The Upcoming filters, remembered for the browser session (not on the server): leaving the screen
// and coming back finds them as they were.
import { useCallback, useState } from 'react'
import { noFilters, type Filters } from './state'

const key = 'kestrel.upcoming.filters'

// sessionStorage can be missing or throw (blocked storage): then the filters start clear and are not remembered.
function load(): Filters {
  try {
    const v: Partial<Filters> = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    return {
      kind: v.kind === 'movie' || v.kind === 'series' ? v.kind : 'all',
      wantedOnly: v.wantedOnly === true,
      hideImported: v.hideImported === true,
    }
  } catch {
    return noFilters
  }
}

export function useUpcomingFilters(): [Filters, (change: Partial<Filters>) => void] {
  const [filters, setFilters] = useState(load)
  const change = useCallback((c: Partial<Filters>) => {
    setFilters((f) => {
      const next = { ...f, ...c }
      try {
        sessionStorage.setItem(key, JSON.stringify(next))
      } catch {
        // not remembered
      }
      return next
    })
  }, [])
  return [filters, change]
}

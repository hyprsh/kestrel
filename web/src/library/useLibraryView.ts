// Whether the Library shows its list or its poster grid, remembered in this browser.
import { useCallback, useState } from 'react'

export type LibraryView = 'list' | 'grid'

const KEY = 'kestrel.library.view'

// localStorage can be missing or throw (private mode, blocked storage): then the list it is, and nothing is remembered.
function load(): LibraryView {
  try {
    return localStorage.getItem(KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

/** The view and the means to change it; a change is remembered for the next visit. */
export function useLibraryView(): [LibraryView, (view: LibraryView) => void] {
  const [view, setView] = useState(load)
  const set = useCallback((next: LibraryView) => {
    setView(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // not remembered
    }
  }, [])
  return [view, set]
}

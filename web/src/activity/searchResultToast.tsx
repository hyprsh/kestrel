// The Toast of a search the user started here (Search now, Upgrade): the server sends `search_finished` with the id the
// POST answered with, and this says what came of it. Only the tab that started the search watches the id, so only it
// toasts; the Toast is mounted in the Shell, so leaving the screen still gets it. The Log keeps its own entry.
import { termText, useToasts } from '@hyprsh/design'
import { useEffect } from 'react'
import { onSearchFinished, takeFinished, type SearchFinished } from '../live/searchFinished'
import { manualSearchPath, placePath } from '../place'

/** What a started search is called in its Toast, and how Manual search narrows to it. */
export type SearchWatch = {
  /** "S01E01 in Standard": the scope and the Slot, as the Toast names them. */
  what: string
  /** The Manual search scope code ("S01E01"), null for the whole Title. */
  scope?: string | null
}

const watched = new Map<string, SearchWatch>()
let show: ((f: SearchFinished, w: SearchWatch) => void) | null = null

/** Follows the search `id` until its `search_finished` arrives (it may already have). */
export function watchSearchResult(id: string, w: SearchWatch) {
  const early = takeFinished(id)
  if (early && show) show(early, w)
  else watched.set(id, w)
}

/** The Toast's words for what a search found. */
export function searchResultText(f: SearchFinished, what: string): string {
  switch (f.outcome) {
    case 'grabbed':
      return f.grabbed.length === 1 ? `Grabbed ${f.grabbed[0]} for ${what}` : `Grabbed ${f.grabbed.length} Releases for ${what}: ${f.grabbed.join(', ')}`
    case 'failed':
      return `Search for ${what} failed${f.error ? `: ${f.error}` : ''}`
    default:
      return f.upgrade ? `No better Release found for ${what}` : `No Release found to grab for ${what}`
  }
}

/** Mounted once, in the Shell, which opens places itself (it is above the provider of `useOpenPlace`). */
export function useSearchResultToasts(open: (path: string) => void) {
  const toasts = useToasts()
  useEffect(() => {
    const present = (f: SearchFinished, w: SearchWatch) => {
      const text = searchResultText(f, w.what)
      const log = { label: 'Open Log', onClick: () => open(placePath('log', termText({ name: 'title', values: [f.title], excluded: false }))) }
      if (f.outcome === 'failed') toasts.error({ text, action: log })
      else if (f.outcome === 'grabbed') toasts.success({ text, action: log })
      else toasts.message({ text, action: { label: 'Manual Search', onClick: () => open(manualSearchPath({ titleId: f.title_id, versionId: f.version_id, scope: w.scope ?? null })) } })
    }
    show = present
    const stop = onSearchFinished((f) => {
      const w = watched.get(f.search_id)
      if (!w) return
      watched.delete(f.search_id)
      takeFinished(f.search_id)
      present(f, w)
    })
    return () => {
      stop()
      show = null
    }
  }, [toasts, open])
}

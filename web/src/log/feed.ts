// The Log's events as the screen reads them: the newest page for the filter, older pages on request, and, while Follow live
// is off, the page as it was when the switch went off with a count of what has happened since.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENTS_PAGE, fetchEvents, useEvents, type LogEvent, type LogFilter } from '../api/log'

const KEY = 'kestrel.log.follow'

/** Follow live, a choice of this browser kept in local storage like the column widths and the theme: on unless it was turned off. */
export function useFollowLive(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'off'
    } catch {
      // no local storage: on, for this visit
      return true
    }
  })
  const set = useCallback((next: boolean) => {
    setOn(next)
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      // no local storage: the choice lasts until the page is left
    }
  }, [])
  return [on, set]
}

/** Events newest first, each once. */
function merged(...lists: readonly (readonly LogEvent[])[]): LogEvent[] {
  const seen = new Map<number, LogEvent>()
  for (const list of lists) for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e)
  return [...seen.values()].sort((a, b) => b.id - a.id)
}

export type Feed = {
  /** The events to show, newest first; undefined until the first page is in. */
  events: LogEvent[] | undefined
  isError: boolean
  /** Whether there may be older events than the ones loaded. */
  more: boolean
  loadingOlder: boolean
  loadOlder: () => void
  /** With Follow live off: how many events came after the ones shown, and whether the count stopped at what one page holds. */
  fresh: { count: number; atLeast: boolean }
  /** Shows the events that came after. */
  showFresh: () => void
}

/**
 * The events of `filter`. With `follow` on the newest page is the stream's: a `log` hint refetches it and new events show at once.
 * With it off the page is held where it was, and `fresh` says what has happened since, from the same refetches.
 */
export function useFeed(filter: LogFilter, enabled: boolean, follow: boolean): Feed {
  const key = JSON.stringify(filter)
  const head = useEvents(filter, enabled)
  const [held, setHeld] = useState<{ key: string; events: LogEvent[] } | null>(null)
  const [older, setOlder] = useState<{ key: string; events: LogEvent[]; done: boolean }>({ key, events: [], done: false })
  const [loading, setLoading] = useState(false)
  const latest = useRef({ key, head: head.data })
  latest.current = { key, head: head.data }

  useEffect(() => {
    if (follow) setHeld(null)
    else if (head.data && (held === null || held.key !== key)) setHeld({ key, events: head.data })
  }, [follow, head.data, key, held])

  const shownHead = follow || held?.key !== key ? head.data : held.events
  const olderNow = older.key === key ? older : { key, events: [], done: false }
  const events = useMemo(() => (shownHead ? merged(shownHead, olderNow.events) : undefined), [shownHead, olderNow.events])
  const more = !!shownHead && !olderNow.done && (olderNow.events.length > 0 || shownHead.length >= EVENTS_PAGE)

  const events_ = useRef(events)
  events_.current = events
  const loadOlder = useCallback(() => {
    const list = events_.current
    if (!list || list.length === 0) return
    setLoading(true)
    const before = list[list.length - 1].id
    fetchEvents(JSON.parse(key) as LogFilter, before)
      .then((page) => {
        if (latest.current.key !== key) return
        setOlder((o) => ({ key, events: merged(o.key === key ? o.events : [], page), done: page.length < EVENTS_PAGE }))
      })
      .catch(() => setOlder((o) => ({ key, events: o.key === key ? o.events : [], done: true })))
      .finally(() => setLoading(false))
  }, [key])

  const newest = shownHead?.[0]?.id ?? 0
  const newer = !follow && head.data && shownHead ? head.data.filter((e) => e.id > newest) : []
  return {
    events,
    isError: head.isError,
    more,
    loadingOlder: loading,
    loadOlder,
    fresh: { count: newer.length, atLeast: newer.length >= EVENTS_PAGE },
    showFresh: () => setHeld(null),
  }
}

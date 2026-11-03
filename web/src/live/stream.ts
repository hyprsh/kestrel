// One live stream per browser (ADR 0010). Browsers allow six HTTP/1.1
// connections per origin, so only one tab opens the EventSource: the one that
// holds a Web Locks lock. It relays every frame to the other tabs over a
// BroadcastChannel. When it closes, the lock passes to another tab, which
// opens the stream and tells everyone to refetch (nothing is replayed).
import type { QueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '../api/client'
import { publishSearchFinished, type SearchFinished } from './searchFinished'

const LOCK = 'kestrel-live-stream'
const CHANNEL = 'kestrel-live'
const EVENTS = ['changed', 'queue', 'activity', 'attention', 'search', 'jobs', 'search_finished'] as const

/** A frame as relayed between tabs; `reset` means "refetch everything you show". */
type Frame = { event: (typeof EVENTS)[number] | 'reset'; data?: unknown; /** A reset with `at` spares the queries that were updated at or after it. */ at?: number }

type ChangedHint = { resource: string; id: number | null }

/** The browser pieces the stream needs; tests substitute fakes. */
export type LiveDeps = {
  url: string
  EventSource: typeof EventSource
  BroadcastChannel: typeof BroadcastChannel
  locks: Pick<LockManager, 'request'> | undefined
}

function browserDeps(): LiveDeps | null {
  if (typeof EventSource === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  return {
    url: `${apiBaseUrl}/stream`,
    EventSource,
    BroadcastChannel,
    locks: typeof navigator !== 'undefined' ? navigator.locks : undefined,
  }
}

/**
 * The query keys a hint invalidates. Titles cover their lists, details and episodes by prefix.
 * A Request's status is derived from its Title, Versions and Grabs, so those refetch the Requests.
 */
function keysOf(h: ChangedHint): string[][] {
  switch (h.resource) {
    case 'title':
      return [['titles'], ['releases'], ['requests'], ['slots']]
    case 'slot':
      // A Slot added, renamed, reordered or removed: its label shows on Titles, Requests and Activity as well.
      return [['slots'], ['titles'], ['requests'], ['grabs']]
    case 'attention':
      return [['attention'], ['status']]
    case 'grab':
      // Activity's lists of stalled and finished Grabs (GET /grabs).
      return [['grabs'], ['requests']]
    case 'request':
      return [['requests']]
    default:
      return [[h.resource]]
  }
}

/** Applies a frame to this tab's caches. */
function applyFrame(qc: QueryClient, f: Frame) {
  switch (f.event) {
    case 'changed':
      for (const queryKey of keysOf(f.data as ChangedHint)) void qc.invalidateQueries({ queryKey })
      return
    case 'queue':
      qc.setQueryData(['queue'], (f.data as { items: unknown[] }).items)
      return
    case 'activity':
    case 'search':
    case 'jobs':
      qc.setQueryData([f.event], f.data)
      return
    case 'search_finished':
      // Not cached state: the tab that started the search toasts it.
      publishSearchFinished(f.data as SearchFinished)
      return
    case 'attention':
      // The frame only says the count moved; the rows and the strip beside them are refetched.
      void qc.invalidateQueries({ queryKey: ['attention'] })
      void qc.invalidateQueries({ queryKey: ['status'] })
      return
    case 'reset': {
      const at = f.at
      // Anything older than the connection, or still in flight, may have missed a change; what resolved after it did not.
      void qc.invalidateQueries(at === undefined ? undefined : { predicate: (q) => q.state.fetchStatus === 'fetching' || q.state.dataUpdatedAt < at })
    }
  }
}

/**
 * Starts keeping qc live. Returns a function that stops it and, when this tab
 * was the leader, hands the stream to another tab.
 */
export function startLiveStream(qc: QueryClient, deps: LiveDeps | null = browserDeps()): () => void {
  if (!deps) return () => {}
  const channel = new deps.BroadcastChannel(CHANNEL)
  channel.onmessage = (e: MessageEvent<Frame>) => applyFrame(qc, e.data)

  let stopped = false
  let release: (() => void) | undefined

  // `fresh` is a tab that took the lock with nobody ahead of it: it just loaded, so only what was fetched before the
  // connection opened can have missed a change; what resolved after it is as new as the stream.
  const lead = (fresh: boolean) =>
    new Promise<void>((done) => {
      if (stopped) return done()
      const es = new deps.EventSource(deps.url)
      const publish = (f: Frame) => {
        applyFrame(qc, f)
        channel.postMessage(f)
      }
      for (const event of EVENTS) {
        es.addEventListener(event, (e) => publish({ event, data: JSON.parse((e as MessageEvent<string>).data) }))
      }
      // Becoming the leader and every reconnect leave a gap: refetch what is shown.
      let opened = false
      es.onopen = () => {
        if (opened) publish({ event: 'reset' })
        else if (fresh) publish({ event: 'reset', at: Date.now() })
        opened = true
      }
      if (!fresh) publish({ event: 'reset' })
      release = () => {
        es.close()
        done()
      }
    })

  const locks = deps.locks
  if (locks) {
    void locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) return lead(true)
      // Another tab leads: wait in line, and refetch when the stream passes to this tab.
      await locks.request(LOCK, () => lead(false))
    })
  } else void lead(true) // no Web Locks (very old browsers): every tab opens its own

  return () => {
    stopped = true
    release?.()
    channel.close()
  }
}

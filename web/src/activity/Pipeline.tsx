// Activity's pipeline: In progress (the search pass and every live Grab) above History (Imported and Failed Grabs by day).
// It stays live through the stream: the queue from `queue` frames, the stalled and finished Grabs from the `grab` hints,
// the search pass from `search` frames.
// chrome: domain-visual
import { Button, EmptyState, EntityList, Note, parseQuery, valuesOf } from '@hyprsh/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFinishedGrabs, useGrabsSummary, useStalledGrabs, type GrabEntry, type GrabsFilter } from '../api/activity'
import { useBlocklist } from '../api/log'
import { useTitles } from '../api/queries'
import { useQueue } from '../api/queue'
import { useSearchStatus } from '../api/search'
import { useKey, useListNav } from '../keys'
import { SkeletonRows } from '../loading'
import { useNow } from '../time'
import { activityFilter, activityQualifiers } from './filter'
import { useSlotNames } from '../library/slots'
import { byDay, DayHeader, HistoryHead, HistoryRow, type Ended } from './History'
import { ActiveRow, SearchPassRow, StalledRow } from './InProgress'
import { entriesOf, stages, type Entry, type Stage } from './stages'

/** The part of a filter the server applies to the Done and Failed history: its words, kinds, Slots, Grab ids, days and indexers. */
function historyFilter(q: ReturnType<typeof parseQuery>): GrabsFilter {
  const grabs = valuesOf(q, 'grab')
  const indexers = valuesOf(q, 'indexer')
  return {
    q: q.text,
    kind: valuesOf(q, 'kind'),
    slot: valuesOf(q, 'slot'),
    // A value that is not an id matches no Grab.
    grab: grabs && grabs.map((g) => (/^\d+$/.test(g) ? Number(g) : 0)),
    day: valuesOf(q, 'day'),
    from: valuesOf(q, 'from')?.[0] ?? null,
    to: valuesOf(q, 'to')?.[0] ?? null,
    indexer: indexers && indexers.map((i) => (/^\d+$/.test(i) ? Number(i) : 0)),
  }
}

/** What the Grabs view shows for a filter: the entries, grouped by stage, and the state of the data behind them. The screen bar's Stage items and count read it too, so it is taken above Pipeline. */
export function usePipeline(query: string) {
  const queue = useQueue()
  const stalled = useStalledGrabs()
  const blocked = useBlocklist()
  const titles = useTitles().data
  const search = useSearchStatus().data

  const slots = useSlotNames()
  const parsed = useMemo(() => parseQuery(query, activityQualifiers(slots)), [query, slots])
  const filter = useMemo(() => activityFilter(parsed), [parsed])
  const history = useMemo(() => historyFilter(parsed), [parsed])
  const chosen = filter.stages ?? stages
  const states = useMemo(() => [...(chosen.includes('done') ? ['imported' as const] : []), ...(chosen.includes('failed') ? ['failed' as const] : [])], [chosen])
  const finished = useFinishedGrabs(history, states)
  const summary = useGrabsSummary(history)
  const grabs = useMemo(() => finished.data?.pages.flatMap((p) => p.items) ?? [], [finished.data])
  const hasMore = Boolean(finished.hasNextPage)
  // Older Blocklist entries wait until the list has loaded back to them.
  const reach = useMemo(() => (hasMore && grabs.length > 0 ? Math.min(...grabs.map((g) => Date.parse(g.updated_at))) : null), [hasMore, grabs])
  const all = useMemo(() => entriesOf(queue.data ?? [], stalled.data ?? [], grabs, blocked.data ?? [], titles ?? [], reach), [queue.data, stalled.data, grabs, blocked.data, titles, reach])
  // The finished Grabs are filtered by the server, over the whole history; the rest here.
  const matching = useMemo(() => all.filter((e) => (e.type === 'grab' && (e.stage === 'done' || e.stage === 'failed')) || filter.matches(e)), [all, filter])
  // Blocklist entries no Grab is left for are not in the server's count: they come in whole.
  const orphans = useMemo(() => entriesOf([], [], [], blocked.data ?? [], titles ?? [], null).filter(filter.matches), [blocked.data, titles, filter])
  const loadedCount = (s: Stage) => matching.filter((e) => e.stage === s).length
  // The search pass is one row of In progress while it runs; a kind, Slot or text filter cannot narrow it.
  const pass = search?.pass && !filter.narrowed ? search.pass : null
  const count = (s: Stage) => {
    if (s === 'searching') return pass ? 1 : 0
    if (s === 'done') return summary.data?.imported ?? loadedCount(s)
    if (s === 'failed') return (summary.data?.failed ?? loadedCount(s) - orphans.length) + orphans.length
    return loadedCount(s)
  }
  const live = chosen.filter((s) => s !== 'searching' && s !== 'done' && s !== 'failed').flatMap((s) => matching.filter((e) => e.stage === s))
  const ended = matching.filter((e): e is Ended => chosen.includes(e.stage) && (e.stage === 'done' || e.stage === 'failed'))
  const shownPass = chosen.includes('searching') ? pass : null
  const rows = [...live, ...ended]
  const oldests = [summary.data?.oldest, ...orphans.map((o) => (o.type === 'blocked' ? o.entry.created_at : null))].filter((d): d is string => Boolean(d))
  return {
    search,
    count,
    pass: shownPass,
    live,
    ended,
    titles: titles ?? [],
    rows,
    total: stages.filter((s) => s !== 'searching').reduce((n, s) => n + count(s), 0),
    /** When the oldest Done or Failed Grab happened, null when there is none. */
    oldest: oldests.length > 0 ? oldests.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null,
    loaded: Boolean(queue.data && stalled.data && blocked.data && (states.length === 0 || finished.data)),
    pending: queue.isPending || stalled.isPending || (states.length > 0 && finished.isPending) || blocked.isPending,
    failed: queue.isError || stalled.isError || finished.isError || blocked.isError,
    history: states.length > 0 ? { hasMore, loading: finished.isFetchingNextPage, loadMore: () => void finished.fetchNextPage() } : null,
  }
}

export type PipelineData = ReturnType<typeof usePipeline>

export function Pipeline({ data, onOpenTitle, onManualSearch }: { data: PipelineData; onOpenTitle: (id: number) => void; onManualSearch: (g: GrabEntry) => void }) {
  const { pass, live, ended, titles, rows, loaded, pending, failed, history } = data
  const now = useNow()
  const [sel, setSel] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const toggle = (e: Entry | undefined) => {
    if (e && (e.stage === 'done' || e.stage === 'failed')) {
      if (e.type === 'grab') setOpenKey((k) => (k === e.key ? null : e.key))
      return
    }
    const id = e && (e.type === 'active' ? e.item.title_id : e.type === 'grab' ? e.grab.title_id : e.entry.title_id)
    if (id != null) onOpenTitle(id)
  }
  useListNav('act', rows.length, Math.min(sel, Math.max(rows.length - 1, 0)), setSel, (i) => toggle(rows[i]))
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('activity-filter')?.focus()
  })

  const inProgress = live.length + (pass ? 1 : 0)
  const days = byDay(ended, now)
  const navOf = (e: Entry) => {
    const index = rows.indexOf(e)
    return { scope: 'act', index, sel, onSelect: () => setSel(index) }
  }
  return (
    <div id="activity-pipeline" className="flex flex-col gap-6">
      {failed && <Note variant="error">Activity could not be loaded in full.</Note>}
      {pending && !loaded && (
        <section aria-label="Loading" className="flex flex-col gap-2">
          <SkeletonRows count={3} poster="md" />
        </section>
      )}
      {inProgress > 0 && (
        <section aria-label="In progress" className="flex flex-col gap-2">
          <h2 className="heading-16">
            In progress <span className="label-14 font-normal text-gray-900">{inProgress}</span>
          </h2>
          <EntityList>
            {pass && <SearchPassRow pass={pass} indexers={data.search?.indexers} />}
            {live.map((e) =>
              e.type === 'active' ? (
                <ActiveRow key={e.key} item={e.item} nav={navOf(e)} onOpenTitle={onOpenTitle} />
              ) : e.type === 'grab' ? (
                <StalledRow key={e.key} grab={e.grab} nav={navOf(e)} onOpenTitle={onOpenTitle} />
              ) : null,
            )}
          </EntityList>
        </section>
      )}
      {ended.length > 0 && (
        <section aria-label="History" className="flex flex-col gap-2">
          <h2 className="heading-16">History</h2>
          <HistoryHead />
          {days.map((d) => (
            <div key={d.day} className="flex flex-col gap-1.5">
              <DayHeader day={d.day} />
              <EntityList aria-label={d.day}>
                {d.rows.map((e) => (
                  <HistoryRow key={e.key} entry={e} titles={titles} nav={navOf(e)} open={openKey === e.key} onToggle={() => toggle(e)} onOpenTitle={onOpenTitle} onManualSearch={onManualSearch} />
                ))}
              </EntityList>
            </div>
          ))}
        </section>
      )}
      {loaded && rows.length === 0 && !pass && (
        <div className="p-4">
          <EmptyState description="Nothing in Activity matches." />
        </div>
      )}
      {history && <HistoryEnd history={history} />}
    </div>
  )
}

/** Below the last row: loads the next page of Done and Failed when it scrolls into view, with a button for where that cannot be seen. */
function HistoryEnd({ history }: { history: NonNullable<PipelineData['history']> }) {
  const end = useRef<HTMLDivElement>(null)
  const { hasMore, loading, loadMore } = history
  const watching = typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const el = end.current
    if (!el || !watching || !hasMore || loading) return
    const seen = new IntersectionObserver((hits) => hits.some((h) => h.isIntersecting) && loadMore(), { rootMargin: '600px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [watching, hasMore, loading, loadMore])
  return (
    <div ref={end} className="label-12 px-4 py-3 text-gray-900">
      {hasMore ? (
        <Button variant="secondary" size="small" disabled={loading} onClick={loadMore}>
          {loading ? 'Loading older Grabs…' : 'Load older Grabs'}
        </Button>
      ) : (
        'That is all the history.'
      )}
    </div>
  )
}

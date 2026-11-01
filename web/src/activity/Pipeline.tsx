// Activity's pipeline section: every Grab from search to Import in one list grouped by stage,
// with stage chips and one filter field above it. It stays live through the stream: the queue
// from `queue` frames, the stalled and finished Grabs from the `grab` hints, Searching from
// `search` frames.
import { Button, DestructiveActionModal, EmptyState, Note, StatusDot, parseQuery, valuesOf } from '@hyprsh/design'
import { RowList } from '../layout/RowList'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFinishedGrabs, useGrabsSummary, useStalledGrabs, useStalledImport, type GrabEntry, type GrabsFilter } from '../api/activity'
import { useSearchNow } from '../api/grabs'
import { useBlocklist } from '../api/log'
import { useTitles } from '../api/queries'
import { useQueue, type QueueItem } from '../api/queue'
import { useCancel } from '../grabs/useCancel'
import { useReport } from '../toasts'
import { useSearchStatus } from '../api/search'
import { SectionBlock } from '../layout/SectionBlock'
import { DownloadRow } from '../grabs/DownloadRow'
import { GrabRow } from '../grabs/GrabRow'
import { useKey, useListNav, type RowNav } from '../keys'
import { size } from '../library/bits'
import { SkeletonRows } from '../loading'
import { SearchSummary } from './SearchSummary'
import { ago, lasting, span, until, useNow } from '../time'
import { cx } from '../ui'
import { activityFilter, activityQualifiers } from './filter'
import { entriesOf, stageLabel, stages, type Entry, type Stage } from './stages'

/** Why a failed Grab failed, in words; an Import's own reasons (`language`, …) are shown as they come. */
const failureText: Record<string, string> = {
  download_failed: 'the download failed',
  encrypted: 'the download is encrypted',
  lost: 'the download client lost the job',
  discarded: 'its stalled Import was discarded',
}

/** Where the Grab came from and what it is: "NZBgeek · Score 1450 · 8.0 GB · grabbed 2 h ago". */
function origin(g: { indexer: string; score: number; size: number; grabbed_at: string }, now: number, extra: string[] = []): string {
  return [g.indexer, `Score ${g.score}`, size(g.size), ...extra, `grabbed ${ago(g.grabbed_at, now)}`].join(' · ')
}

/** The download speed the client's ETA implies, or null when it has not said. */
function speed(i: QueueItem): string | null {
  if (i.phase !== 'downloading' || !i.eta || i.bytes_left <= 0) return null
  return `${size(i.bytes_left / i.eta)}/s`
}

/** Why a Stuck download is stuck, in words. Not a Stalled Import: that is its own stage. */
function stuckText(s: NonNullable<QueueItem['stuck']>, now: number): string {
  return s.reason === 'paused' ? 'Stuck: paused in the download client' : `Stuck: no progress for ${span(now - Date.parse(s.since))}`
}

function Line({ tone, children }: { tone?: 'amber' | 'red'; children: ReactNode }) {
  return <div className={cx('label-12', tone === 'amber' ? 'text-amber-900' : tone === 'red' ? 'text-red-900' : 'text-gray-900')}>{children}</div>
}

/** The part of a filter the server applies to the Done and Failed history: its words, kinds, Slots and Grab ids. */
function historyFilter(q: ReturnType<typeof parseQuery>): GrabsFilter {
  const grabs = valuesOf(q, 'grab')
  return {
    q: q.text,
    kind: valuesOf(q, 'kind'),
    slot: valuesOf(q, 'slot'),
    // A value that is not an id matches no Grab.
    grab: grabs && grabs.map((g) => (/^\d+$/.test(g) ? Number(g) : 0)),
  }
}

/** What the Grabs view shows for a filter: the entries, grouped by stage, and the state of the data behind them. The screen bar's Stage items and count read it too, so it is taken above Pipeline. */
export function usePipeline(query: string) {
  const queue = useQueue()
  const stalled = useStalledGrabs()
  const blocked = useBlocklist()
  const titles = useTitles().data
  const search = useSearchStatus().data

  const parsed = useMemo(() => parseQuery(query, activityQualifiers), [query])
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
  const count = (s: Stage) => {
    if (s === 'searching') return search?.due.versions ?? 0
    if (s === 'done') return summary.data?.imported ?? loadedCount(s)
    if (s === 'failed') return (summary.data?.failed ?? loadedCount(s) - orphans.length) + orphans.length
    return loadedCount(s)
  }
  // Searching is one summary of the pipeline, not rows: a kind, Slot or text filter cannot narrow it.
  const searching = search && chosen.includes('searching') && !filter.narrowed && (search.due.versions > 0 || search.pass !== null)
  const groups = chosen.filter((s) => s !== 'searching').map((s) => ({ stage: s, entries: matching.filter((e) => e.stage === s) }))
  const rows = groups.flatMap((g) => g.entries)
  const oldests = [summary.data?.oldest, ...orphans.map((o) => (o.type === 'blocked' ? o.entry.created_at : null))].filter((d): d is string => Boolean(d))
  return {
    search,
    count,
    chosen,
    searching,
    groups,
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

export function Pipeline({ data, onOpenTitle }: { data: PipelineData; onOpenTitle: (id: number) => void }) {
  const { search, count, searching, groups, rows, loaded, pending, failed, history } = data
  const now = useNow()
  const [sel, setSel] = useState(0)

  const open = (e: Entry | undefined) => {
    const id = e && (e.type === 'active' ? e.item.title_id : e.type === 'grab' ? e.grab.title_id : e.entry.title_id)
    if (id != null) onOpenTitle(id)
  }
  useListNav('act', rows.length, Math.min(sel, Math.max(rows.length - 1, 0)), setSel, (i) => open(rows[i]))
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('activity-filter')?.focus()
  })

  let index = 0
  return (
    <section id="activity-pipeline" aria-label="Pipeline" className="flex flex-col gap-8">
      {failed && <Note variant="error">Activity could not be loaded in full.</Note>}
      {searching && search && (
        <SectionBlock title={stageLabel.searching} count={count('searching')}>
          <div>
            <SearchSummary status={search} onOpenTitle={onOpenTitle} />
          </div>
        </SectionBlock>
      )}
      {pending && (
        <>
          {[stageLabel.downloading, stageLabel.done].map((title) => (
            <SectionBlock key={title} title={title}>
              <div>
                <SkeletonRows count={2} poster="md" />
              </div>
            </SectionBlock>
          ))}
        </>
      )}
      {groups.map(
        (g) =>
          g.entries.length > 0 && (
            <SectionBlock key={g.stage} title={stageLabel[g.stage]} count={count(g.stage)}>
              <div>
                <RowList aria-label={stageLabel[g.stage]}>
                  {g.entries.map((e) => {
                    const i = index++
                    return <EntryRow key={e.key} entry={e} now={now} nav={{ scope: 'act', index: i, sel, onSelect: () => setSel(i) }} onOpenTitle={onOpenTitle} />
                  })}
                </RowList>
              </div>
            </SectionBlock>
          ),
      )}
      {loaded && rows.length === 0 && !searching && (
        <div className="p-4">
          <EmptyState description="Nothing in Activity matches." />
        </div>
      )}
      {history && <HistoryEnd history={history} />}
    </section>
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

function EntryRow({ entry: e, now, nav, onOpenTitle }: { entry: Entry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  switch (e.type) {
    case 'active':
      return <ActiveRow item={e.item} now={now} nav={nav} onOpenTitle={onOpenTitle} />
    case 'grab':
      return e.stage === 'stalled' ? <StalledRow grab={e.grab} now={now} nav={nav} onOpenTitle={onOpenTitle} /> : <FinishedRow grab={e.grab} now={now} nav={nav} onOpenTitle={onOpenTitle} />
    case 'blocked': {
      const t = e.title
      const subject = {
        title_id: e.entry.title_id,
        has_poster: t?.has_poster ?? false,
        title: t?.title ?? '',
        year: t?.year ?? null,
        slot: null,
        episodes: [],
        release_name: e.entry.release_name,
        is_upgrade: false,
      }
      return (
        <GrabRow grab={subject} nav={nav} onOpenTitle={onOpenTitle}>
          <Line tone="red">{`Blocklisted ${ago(e.entry.created_at, now)}: ${e.entry.reason}`}</Line>
          <Line>{size(e.entry.size)}</Line>
        </GrabRow>
      )
    }
  }
}

function ActiveRow({ item: i, now, nav, onOpenTitle }: { item: QueueItem; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const cancel = useCancel()
  const rate = speed(i)
  return (
    <DownloadRow
      item={i}
      nav={nav}
      busy={cancel.pending}
      onCancel={(blocklist) => void cancel.run(i.grab_id, blocklist)}
      onOpenTitle={onOpenTitle}
      detail={
        <>
          {i.stuck && (
            <Line tone="amber">
              <StatusDot state="warning" label={false} aria-hidden /> {stuckText(i.stuck, now)}
            </Line>
          )}
          <Line>{`${origin(i, now, rate ? [rate] : [])} · in this stage ${lasting(i.phase_since, now)}`}</Line>
        </>
      }
    />
  )
}

function StalledRow({ grab: g, now, nav, onOpenTitle }: { grab: GrabEntry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const act = useStalledImport()
  const report = useReport()
  const st = g.stalled!
  const [asking, setAsking] = useState(false)
  return (
    <>
      <GrabRow
        grab={g}
        nav={nav}
        onOpenTitle={onOpenTitle}
        actions={
          <>
            <Button
              variant="secondary"
              size="small"
              disabled={act.isPending}
              onClick={() => void report(act.mutateAsync({ id: g.grab_id, action: 'retry' }), { done: 'Import retried', failed: 'Could not retry the import' })}
            >
              Retry now
            </Button>
            <Button variant="secondary" size="small" disabled={act.isPending} onClick={() => setAsking(true)}>
              Discard
            </Button>
          </>
        }
      >
        <Line tone="amber">{`Import stalled ${lasting(st.since, now)}: ${st.reason} · tried again ${until(st.next_at, now)}`}</Line>
        <Line>{origin(g, now)}</Line>
      </GrabRow>
      <DestructiveActionModal
        open={asking}
        title="Discard this Grab"
        confirmLabel="Discard"
        description="Its downloaded files are deleted and the Version is searched for again."
        loading={act.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          void report(act.mutateAsync({ id: g.grab_id, action: 'discard' }), { done: 'Grab discarded', failed: 'Could not discard the Grab' })
        }}
      />
    </>
  )
}

function FinishedRow({ grab: g, now, nav, onOpenTitle }: { grab: GrabEntry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const search = useSearchNow()
  const report = useReport()
  const versionId = g.version_id
  const failed = g.state === 'failed'
  const why = g.failure ? (failureText[g.failure] ?? g.failure) : 'it failed'
  return (
    <GrabRow
      grab={g}
      nav={nav}
      onOpenTitle={onOpenTitle}
      actions={
        failed &&
        versionId !== null && (
          <Button
            variant="secondary"
            size="small"
            disabled={search.isPending || search.isSuccess}
            onClick={() => void report(search.mutateAsync({ versionId }), { started: `Search started for ${g.title}`, failed: `Could not search ${g.title}` })}
          >
            {search.isSuccess ? 'Searching…' : 'Search again'}
          </Button>
        )
      }
    >
      {failed ? (
        <Line tone="red">
          {`Failed ${ago(g.updated_at, now)}: ${why}`}
          {g.blocklist_reason && ` · Blocklisted: ${g.blocklist_reason}`}
        </Line>
      ) : (
        <Line>
          {`Imported ${ago(g.updated_at, now)}`}
          {g.blocklist_reason && ` · since blocklisted: ${g.blocklist_reason}`}
        </Line>
      )}
      <Line>{origin(g, now)}</Line>
      {search.isError && <Line tone="red">{search.error.message}</Line>}
    </GrabRow>
  )
}

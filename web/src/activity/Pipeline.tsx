// Activity's pipeline section: every Grab from search to Import in one list grouped by stage,
// with stage chips and one filter field above it. It stays live through the stream: the queue
// from `queue` frames, the stalled and finished Grabs from the `grab` hints, Searching from
// `search` frames.
import { Button, EmptyState, Note } from '@hyprsh/design'
import { useMemo, useState, type ReactNode } from 'react'
import { useFinishedGrabs, useStalledGrabs, useStalledImport, HISTORY_DAYS, type GrabEntry } from '../api/activity'
import { useSearchNow } from '../api/grabs'
import { useBlocklist } from '../api/log'
import { useTitles } from '../api/queries'
import { useCancelGrab, useQueue, type QueueItem } from '../api/queue'
import { useSearchStatus } from '../api/search'
import { parse } from '../filter/query'
import { QueryField } from '../filter/QueryField'
import { DownloadRow } from '../grabs/DownloadRow'
import { GrabRow } from '../grabs/GrabRow'
import { useKey, useListNav, type RowNav } from '../keys'
import { size } from '../library/bits'
import { SearchSummary } from '../overview/Searching'
import { useOpenPlace } from '../place'
import { ago, lasting, until, useNow } from '../time'
import { cx } from '../ui'
import { activityFilter, activityQualifiers, toggleStage } from './filter'
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

function Line({ tone, children }: { tone?: 'amber' | 'red'; children: ReactNode }) {
  return <div className={cx('label-12', tone === 'amber' ? 'text-amber-900' : tone === 'red' ? 'text-red-900' : 'text-gray-900')}>{children}</div>
}

export function Pipeline({ query, onQuery, onOpenTitle }: { query: string; onQuery: (q: string) => void; onOpenTitle: (id: number) => void }) {
  const queue = useQueue()
  const stalled = useStalledGrabs()
  const finished = useFinishedGrabs()
  const blocked = useBlocklist()
  const titles = useTitles().data
  const search = useSearchStatus().data
  const openPlace = useOpenPlace()
  const now = useNow()
  const [sel, setSel] = useState(0)

  const parsed = useMemo(() => parse(query, activityQualifiers), [query])
  const filter = useMemo(() => activityFilter(parsed), [parsed])
  const all = useMemo(
    () => entriesOf(queue.data ?? [], stalled.data ?? [], finished.data?.items ?? [], blocked.data ?? [], titles ?? [], now),
    [queue.data, stalled.data, finished.data, blocked.data, titles, now],
  )
  const matching = useMemo(() => all.filter(filter.matches), [all, filter])
  const count = (s: Stage) => (s === 'searching' ? (search?.due.versions ?? 0) : matching.filter((e) => e.stage === s).length)
  const chosen = filter.stages ?? stages
  // Searching is one summary of the pipeline, not rows: a kind, Slot or text filter cannot narrow it.
  const searching = search && chosen.includes('searching') && !filter.narrowed && (search.due.versions > 0 || search.pass !== null)
  const groups = chosen.filter((s) => s !== 'searching').map((s) => ({ stage: s, entries: matching.filter((e) => e.stage === s) }))
  const rows = groups.flatMap((g) => g.entries)

  const open = (e: Entry | undefined) => {
    const id = e && (e.type === 'active' ? e.item.title_id : e.type === 'grab' ? e.grab.title_id : e.entry.title_id)
    if (id != null) onOpenTitle(id)
  }
  useListNav('act', rows.length, Math.min(sel, Math.max(rows.length - 1, 0)), setSel, (i) => open(rows[i]))
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('activity-filter')?.focus()
  })

  const loaded = queue.data && stalled.data && finished.data && blocked.data
  const failed = queue.isError || stalled.isError || finished.isError || blocked.isError
  let index = 0
  return (
    <section id="activity-pipeline" aria-label="Pipeline" className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-gray-alpha-400 px-4 py-2">
        <QueryField
          id="activity-filter"
          label="Filter Activity"
          placeholder="Filter, e.g. stage:failed kind:series slot:4k …  /"
          value={query}
          onChange={onQuery}
          qualifiers={activityQualifiers}
        />
        <div role="group" aria-label="Stages" className="flex flex-wrap gap-1.5">
          {stages.map((s) => {
            const on = filter.stages?.includes(s) ?? false
            return (
              <Button
                key={s}
                variant={on ? 'primary' : 'secondary'}
                size="tiny"
                shape="rounded"
                aria-pressed={on}
                onClick={() => onQuery(toggleStage(query, s))}
              >
                {stageLabel[s]} <span className="tabular-nums">{count(s)}</span>
              </Button>
            )
          })}
        </div>
      </div>
      {failed && <Note variant="error">Activity could not be loaded in full.</Note>}
      {searching && (
        <Group stage="searching" count={count('searching')}>
          <div className="px-4 py-3">
            <SearchSummary status={search} />
          </div>
        </Group>
      )}
      {groups.map(
        (g) =>
          g.entries.length > 0 && (
            <Group key={g.stage} stage={g.stage} count={g.entries.length}>
              <ul aria-label={stageLabel[g.stage]}>
                {g.entries.map((e) => {
                  const i = index++
                  return <EntryRow key={e.key} entry={e} now={now} nav={{ scope: 'act', index: i, sel, onSelect: () => setSel(i) }} onOpenTitle={onOpenTitle} />
                })}
              </ul>
            </Group>
          ),
      )}
      {loaded && rows.length === 0 && !searching && <EmptyState className="m-4" description="Nothing in Activity matches." />}
      {(chosen.includes('done') || chosen.includes('failed')) && (
        <p className="label-12 px-4 py-3 text-gray-900">
          {finished.data?.more ? `Done and Failed show the latest ${finished.data.items.length} Grabs. ` : `Done and Failed reach back ${HISTORY_DAYS} days. `}
          <button type="button" className="underline hover:text-gray-1000" onClick={() => openPlace('/log?q=kind:grabs,imports')}>
            Older ones are in the Log
          </button>
        </p>
      )}
    </section>
  )
}

function Group({ stage, count, children }: { stage: Stage; count: number; children: ReactNode }) {
  const id = `activity-stage-${stage}`
  return (
    <section aria-labelledby={id} className="border-b border-gray-alpha-200">
      <h3 id={id} className="label-12 px-4 pt-4 pb-1 font-medium text-gray-900">{`${stageLabel[stage]} · ${count}`}</h3>
      {children}
    </section>
  )
}

function EntryRow({ entry: e, now, nav, onOpenTitle }: { entry: Entry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  switch (e.type) {
    case 'active':
      return <ActiveRow item={e.item} now={now} nav={nav} onOpenTitle={onOpenTitle} />
    case 'grab':
      return e.stage === 'stalled' ? (
        <StalledRow grab={e.grab} now={now} nav={nav} onOpenTitle={onOpenTitle} />
      ) : (
        <FinishedRow grab={e.grab} now={now} nav={nav} onOpenTitle={onOpenTitle} />
      )
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
  const cancel = useCancelGrab()
  const rate = speed(i)
  return (
    <DownloadRow
      item={i}
      nav={nav}
      busy={cancel.isPending}
      onCancel={(blocklist) => cancel.mutate({ id: i.grab_id, blocklist })}
      onOpenTitle={onOpenTitle}
      detail={
        <>
          <Line>{`${origin(i, now, rate ? [rate] : [])} · in this stage ${lasting(i.phase_since, now)}`}</Line>
          {cancel.isError && <Line tone="red">{cancel.error.message}</Line>}
        </>
      }
    />
  )
}

function StalledRow({ grab: g, now, nav, onOpenTitle }: { grab: GrabEntry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const act = useStalledImport()
  const st = g.stalled!
  const discard = () => {
    if (window.confirm('Discard this Grab? Its downloaded files are deleted and the Version is searched for again.')) act.mutate({ id: g.grab_id, action: 'discard' })
  }
  return (
    <GrabRow
      grab={g}
      nav={nav}
      onOpenTitle={onOpenTitle}
      actions={
        <>
          <Button variant="secondary" size="small" disabled={act.isPending} onClick={() => act.mutate({ id: g.grab_id, action: 'retry' })}>
            Retry now
          </Button>
          <Button variant="secondary" size="small" disabled={act.isPending} onClick={discard}>
            Discard
          </Button>
        </>
      }
    >
      <Line tone="amber">{`Import stalled ${lasting(st.since, now)}: ${st.reason} · tried again ${until(st.next_at, now)}`}</Line>
      <Line>{origin(g, now)}</Line>
      {act.isError && <Line tone="red">{act.error.message}</Line>}
    </GrabRow>
  )
}

function FinishedRow({ grab: g, now, nav, onOpenTitle }: { grab: GrabEntry; now: number; nav: RowNav; onOpenTitle: (id: number) => void }) {
  const search = useSearchNow()
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
          <Button variant="secondary" size="small" disabled={search.isPending || search.isSuccess} onClick={() => search.mutate({ versionId })}>
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

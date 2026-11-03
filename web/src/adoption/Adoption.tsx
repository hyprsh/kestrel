// The Adoption review screen: scan the Movie and Series Root folders, review the plan of matched,
// needs-choice and skipped entries, settle the doubtful ones and adopt what is ticked.
import { useMemo, useState, type FormEvent } from 'react'
import {
  useAdoption,
  useAdoptionRows,
  useBulkRows,
  useCommit,
  useDiscard,
  usePatchPlan,
  usePatchRow,
  useReopen,
  useRetry,
  useScan,
  type Adoption as AdoptionPlan,
  type AdoptionFile,
  type AdoptionMonitor,
  type AdoptionRow,
  type AdoptionBulkRowResult,
  type AdoptionRowsBulk,
} from '../api/adoption'
import { ApiError, useLookup } from '../api/queries'
import { useOpenCleanup } from '../cleanup/launch'
import { LoadingRegion, SkeletonRows } from '../loading'
import { useSlotNames, type SlotNames } from '../library/slots'
import { PosterSkeleton, TitlePoster } from '../poster'
import { PanelContent, SidePanel } from '../layout/SidePanel'
import { TickBox } from '../library/TickBox'
import { useSelection } from '../selection'
import { useReport } from '../toasts'
import { Finished, type FinishedActions } from './Finished'
import { currentText, skipText } from './text'
import { ActionBar, Badge, Button, Checkbox, EmptyState, Entity, Input, LoadMoreButton, Note, Select, Skeleton, Spinner, useToasts } from '@hyprsh/design'

type Filter = 'all' | 'matched' | 'needs_choice' | 'skipped' | 'duplicate' | 'replacement'

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'needs_choice', label: 'Needs choice' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'replacement', label: 'Replacements' },
]

const monitorLabel: Record<AdoptionMonitor, string> = { all: 'Monitored', future: 'Series: future episodes only', none: 'Unmonitored' }
/** The bar's quiet action for each monitoring the selected rows can be set to. */
const monitorAction: Record<AdoptionMonitor, string> = { all: 'Monitor', future: 'Monitor Future Episodes Only', none: 'Unmonitor' }
const planMonitorOptions = (['all', 'future', 'none'] as const).map((value) => ({ value, label: monitorLabel[value] }))
/** A row's choices: a Series has Add Title's three that need no season list, a Movie is monitored or not. */
const rowMonitorOptions = (kind: AdoptionRow['kind']) =>
  kind === 'series'
    ? [
        { value: 'all', label: 'All episodes' },
        { value: 'future', label: 'Future episodes only' },
        { value: 'none', label: 'Unmonitored' },
      ]
    : [
        { value: 'all', label: 'Monitored' },
        { value: 'none', label: 'Unmonitored' },
      ]

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** "S01E02" or "S01E02-E03" for a Series file, "" for a Movie file. */
function episodeLabel(f: AdoptionFile) {
  if (f.episodes.length === 0) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = f.episodes[0]
  const last = f.episodes[f.episodes.length - 1]
  return `S${pad(first.season)}E${pad(first.number)}${last.number !== first.number ? `-E${pad(last.number)}` : ''}`
}

/** The Versions a Series row proposes, e.g. "Standard: 38 episodes, 4K: 4 episodes". */
function versionsSummary(row: AdoptionRow, slots: SlotNames) {
  const counts = new Map<string, number>()
  for (const f of row.files) if (f.ticked && !f.left) counts.set(f.slot, (counts.get(f.slot) ?? 0) + f.episodes.length)
  return slots
    .order([...counts.keys()])
    .map((s) => `${slots.name(s)}: ${counts.get(s)} ${counts.get(s) === 1 ? 'episode' : 'episodes'}`)
    .join(', ')
}

/** Why a bulk action left a row alone, as the end of "N left for you because …". */
const leftText: Record<string, string> = {
  not_confident: 'the suggestion is not confident enough',
  no_suggestion: 'there is no suggestion',
  not_needs_choice: 'the row was not waiting for a choice',
  not_settleable: 'the suggested Title cannot be matched',
  not_matched: 'the row is not a Matched one',
  already: 'the row already was so',
  tracked: 'the Title is in the Library and keeps its monitoring',
  no_such_row: 'the row is gone',
}

/** What a bulk action did, in a sentence; "" when there is nothing to say. */
function bulkReport(action: AdoptionRowsBulk['action'], items: AdoptionBulkRowResult[], monitor?: AdoptionMonitor) {
  const done = items.filter((i) => i.result === 'changed')
  const left = items.filter((i) => i.result !== 'changed')
  const parts: string[] = []
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (action === 'accept_suggested') {
    parts.push(`Accepted ${plural(done.length, 'suggested match', 'suggested matches')}.`)
    const skipped = done.filter((i) => i.status === 'skipped').length
    if (skipped > 0) parts.push(`${skipped} of them could not be adopted and ${skipped === 1 ? 'is' : 'are'} Skipped.`)
  }
  if (action === 'set_monitor') parts.push(`Set ${plural(done.length, 'row', 'rows')} to ${monitorLabel[monitor ?? 'all']}.`)
  if (left.length > 0) {
    const why = new Map<string, number>()
    for (const i of left) {
      const k = i.result === 'failed' ? 'failed' : (i.reason ?? '')
      why.set(k, (why.get(k) ?? 0) + 1)
    }
    const clause = (k: string) => (k === 'failed' ? 'Kestrel could not plan it (see the Log)' : (leftText[k] ?? k))
    const kinds = [...why]
    const who = action === 'accept_suggested' ? 'for you' : 'as they were'
    parts.push(kinds.length === 1 ? `${left.length} left ${who} because ${clause(kinds[0][0])}.` : `${left.length} left ${who}: ${kinds.map(([k, n]) => `${n} because ${clause(k)}`).join(', ')}.`)
  }
  return parts.join(' ')
}

export function Adoption({ embedded = false }: { embedded?: boolean } = {}) {
  const plan = useAdoption()
  const scan = useScan()
  const commit = useCommit()
  const discard = useDiscard()
  const retry = useRetry()
  const reopen = useReopen()
  const patchPlan = usePatchPlan()
  const toast = useReport()
  const toasts = useToasts()
  // Adoption shows its progress on its own screen, so its "started" Toasts carry no link to Activity (useReport's `started` would add one).
  // A failure shows inline on this screen, so there is no error Toast either.
  const started = (work: Promise<unknown>, text: string) =>
    void work.then(
      () => toasts.message(text),
      () => undefined,
    )
  const [filter, setFilter] = useState<Filter>('all')
  const state = plan.data?.state
  const p = plan.data
  const failed = scan.error ?? commit.error ?? discard.error ?? retry.error ?? reopen.error

  // The plan's controls: the summary and the two Selects, and the buttons that act on the whole plan.
  const planned = p && state === 'planned'
  const planFilters = planned && (
    <>
      <div role="status" className="copy-14 text-gray-900">
        {p.summary.matched} matched, {p.summary.needs_choice} need a choice, {p.summary.skipped} skipped
      </div>
      <Select aria-label="Show" size="small" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} options={filters.map((f) => ({ value: f.key, label: f.label }))} />
      <Select
        aria-label="Monitoring"
        size="small"
        value={p.monitor}
        onChange={(e) => patchPlan.mutate(e.target.value as AdoptionMonitor)}
        disabled={patchPlan.isPending}
        options={planMonitorOptions}
      />
    </>
  )
  const busy = commit.isPending || discard.isPending
  const planButtons = planned && (
    <>
      <Button size="small" onClick={() => void toast(discard.mutateAsync(), { done: 'Adoption plan discarded' })} disabled={busy}>
        Discard Plan
      </Button>
      <Button variant="primary" size="small" onClick={() => started(commit.mutateAsync(p.revision), 'Adopting the plan started')} disabled={busy || p.summary.adopting === 0}>
        Adopt {p.summary.adopting} {p.summary.adopting === 1 ? 'Title' : 'Titles'}
      </Button>
    </>
  )
  const scanButton = p && (state === 'idle' || state === undefined) && (
    <Button variant="primary" size="small" onClick={() => started(scan.mutateAsync(), 'Scan for unmanaged files started')} disabled={scan.isPending}>
      Scan for Unmanaged Files
    </Button>
  )

  const body = !p ? (
    <div className="copy-14 text-gray-900">
      {plan.isError ? (
        'Could not read the Adoption state.'
      ) : (
        <LoadingRegion>
          <SkeletonRows count={3} />
        </LoadingRegion>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <p className="copy-14 text-gray-900">
        Kestrel scans your Movie and Series Root folders and plans how to manage the files already there without downloading them again. Nothing changes until you adopt the plan.
      </p>
      {failed instanceof ApiError && (
        <Note variant="error" size="small">
          {failed.message}
        </Note>
      )}

      {(state === 'idle' || state === undefined) && (
        <>
          {p.error && (
            <Note variant="error" size="small">
              {p.error}
            </Note>
          )}
          {p.result && <Kept result={p.result} actions={{ onRetry: () => retry.mutate(), onReopen: () => reopen.mutate(), busy: retry.isPending || reopen.isPending }} />}
          {embedded && <div>{scanButton}</div>}
        </>
      )}

      {(state === 'scanning' || state === 'committing') && (
        <Note role="status" icon={<Spinner size="sm" />}>
          <div>
            {state === 'scanning' ? 'Scanning' : 'Adopting'}… {p.progress.done} of {p.progress.total}
          </div>
          {p.progress.current && <div className="copy-13 break-all text-gray-900">{currentText(p.progress.current)}</div>}
        </Note>
      )}

      {state === 'planned' && p.result && <Kept result={p.result} />}
      {state === 'planned' && (
        <>
          {embedded && (
            <div className="flex flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch">
              {planFilters}
              <div className="ml-auto flex gap-2 max-sm:ml-0 max-sm:[&>*]:flex-1">{planButtons}</div>
            </div>
          )}
          {patchPlan.error instanceof ApiError && (
            <Note variant="error" size="small">
              {patchPlan.error.message}
            </Note>
          )}
          {/* Keyed by the filter, so a change of it starts with nothing ticked and no report. */}
          <Plan key={filter} filter={filter} summary={p.summary} monitor={p.monitor} />
        </>
      )}
    </div>
  )

  if (embedded) return body
  return (
    <div className="flex min-h-0 flex-1 max-sm:flex-col">
      <SidePanel
        title="Adopt existing library"
        filter={planned ? <div className="flex flex-col gap-2.5">{planFilters}</div> : undefined}
        chips={planned ? <div className="flex gap-2 [&>*]:flex-1">{planButtons}</div> : scanButton ? <div className="flex [&>*]:flex-1">{scanButton}</div> : undefined}
      />
      <PanelContent reading>{body}</PanelContent>
    </div>
  )
}

/** What the last commit did and the rows it kept, which stay until the next scan whatever happens to the plan. */
function Kept({ result, actions }: { result: NonNullable<AdoptionPlan['result']>; actions?: FinishedActions }) {
  const openCleanup = useOpenCleanup()
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Note
        role="status"
        action={
          result.adopted > 0 ? (
            <Button size="small" onClick={() => openCleanup(result.title_ids)}>
              Clean Up Adopted Folders
            </Button>
          ) : undefined
        }
      >
        {`Adopted ${result.adopted} ${result.adopted === 1 ? 'Title' : 'Titles'}${result.failed > 0 ? `, ${result.failed} could not be adopted` : ''}.`}
      </Note>
      <Finished outcomes={result.outcomes} actions={actions} />
    </div>
  )
}

function Plan({ filter, summary, monitor }: { filter: Filter; summary: AdoptionPlan['summary']; monitor: AdoptionMonitor }) {
  const list = useAdoptionRows({ filter }, true)
  const bulk = useBulkRows()
  const [report, setReport] = useState('')
  const rows = useMemo(() => list.data?.pages.flatMap((pg) => pg.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0
  const more = total > rows.length
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selection = useSelection(ids, total)
  const planEmpty = summary.matched + summary.needs_choice + summary.skipped === 0
  const run = (action: AdoptionRowsBulk['action'], setTo?: AdoptionMonitor) => {
    const body: AdoptionRowsBulk = { action, ...(setTo && { monitor: setTo }), ...(selection.all ? { filter } : { row_ids: selection.checked }) }
    bulk.mutate(body, {
      onSuccess: (res) => {
        setReport(bulkReport(action, res.items, setTo))
        selection.clear()
      },
    })
  }
  return (
    <div>
      {bulk.error instanceof ApiError && (
        <Note variant="error" size="small" className="mb-2">
          {bulk.error.message}
        </Note>
      )}
      {report && (
        <Note size="small" className="mb-2">
          {report}
        </Note>
      )}
      {!selection.active && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="tertiary" size="small" onClick={selection.checkAll}>
            Select All {rows.length} Shown
          </Button>
          {total > rows.length && (
            <Button variant="tertiary" size="small" onClick={selection.checkMatching}>
              Select All {total} in This Filter
            </Button>
          )}
        </div>
      )}
      {list.isPending ? (
        <Entity.List aria-busy="true" aria-label="Loading the plan">
          {[0, 1, 2].map((i) => (
            <Entity
              key={i}
              left={
                <>
                  <Skeleton width={16} height={16} />
                  <PosterSkeleton size="md" />
                </>
              }
            >
              <Entity.Content fill title={<Skeleton width="50%" height={16} />} description={<Skeleton width="30%" height={16} />} />
            </Entity>
          ))}
        </Entity.List>
      ) : rows.length === 0 ? (
        <EmptyState title={planEmpty ? 'No Files To Adopt' : 'No Rows Match'} description={planEmpty ? 'No files to adopt were found.' : 'No rows match this filter.'} />
      ) : (
        <>
          <Entity.List aria-label="Adoption plan">
            {rows.map((r) => (
              <Entity
                key={r.id}
                leftClassName="items-start"
                left={
                  <>
                    <TickBox selection={selection} id={r.id} name={baseName(r.entry)} verb="Select" />
                    {r.status === 'matched' && r.match?.title_id != null && <TitlePoster id={r.match.title_id} hasPoster={r.match.has_poster ?? false} size="md" />}
                  </>
                }
              >
                <Entity.Content fill>
                  <Row row={r} planMonitor={monitor} />
                </Entity.Content>
              </Entity>
            ))}
          </Entity.List>
          <div className="copy-13 mt-3 flex items-center gap-3 text-gray-900">
            <span>
              Showing {rows.length} of {total}
            </span>
            {list.hasNextPage && (
              <LoadMoreButton size="small" noGap loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Show More
              </LoadMoreButton>
            )}
          </div>
        </>
      )}
      <ActionBar
        open={selection.active}
        // "Select all N" is the whole filter when it pages past the rows loaded, else the rows shown.
        selection={{
          count: selection.count,
          total: more ? total : rows.length,
          onSelectAll: more ? selection.checkMatching : selection.checkAll,
          onClear: selection.clear,
        }}
        secondaryActions={[
          { label: "Don't Adopt Selected", disabled: bulk.isPending, onSelect: () => run('untick') },
          { label: 'Accept Suggested Matches', disabled: bulk.isPending, onSelect: () => run('accept_suggested') },
          ...(['all', 'future', 'none'] as const).map((m) => ({ label: monitorAction[m], disabled: bulk.isPending, onSelect: () => run('set_monitor', m) })),
        ]}
        actions={
          <Button variant="primary" size="small" onClick={() => run('tick')} disabled={bulk.isPending}>
            Adopt Selected
          </Button>
        }
      />
    </div>
  )
}

function Row({ row, planMonitor }: { row: AdoptionRow; planMonitor: AdoptionMonitor }) {
  if (row.status === 'matched') return <MatchedRow row={row} planMonitor={planMonitor} />
  if (row.status === 'needs_choice') return <NeedsChoice row={row} />
  return (
    <div>
      <div className="label-14">{baseName(row.entry)}</div>
      <div className="label-12 mt-0.5 flex items-center gap-2 text-gray-900">
        <Badge variant="gray" contrast="low" size="sm">
          Skipped
        </Badge>
        {skipText[row.skip_reason ?? ''] ?? row.skip_reason}
      </div>
    </div>
  )
}

function MatchedRow({ row, planMonitor }: { row: AdoptionRow; planMonitor: AdoptionMonitor }) {
  const slots = useSlotNames()
  const patch = usePatchRow()
  const m = row.match!
  const title = `${m.title}${m.year ? ` (${m.year})` : ''}`
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 max-sm:gap-y-1">
        <Checkbox checked={row.ticked} onChange={(e) => patch.mutate({ id: row.id, patch: { ticked: e.target.checked } })} aria-label={`Adopt ${title}`}>
          <span className="label-14">{title}</span>
        </Checkbox>
        {m.title_id !== null && (
          <Badge variant="blue" contrast="low" size="sm">
            In library
          </Badge>
        )}
        <span className="copy-13 min-w-0 break-all text-gray-900">{baseName(row.entry)}</span>
        {m.title_id !== null ? (
          <span className="copy-13 text-gray-900">Keeps its own monitoring</span>
        ) : (
          <Select
            aria-label={`Monitoring of ${title}`}
            size="small"
            // A Movie has no future episodes: the plan's choice of them reads as monitored.
            value={row.monitor ?? (row.kind === 'movie' && planMonitor === 'future' ? 'all' : planMonitor)}
            onChange={(e) => patch.mutate({ id: row.id, patch: { monitor: e.target.value as AdoptionMonitor } })}
            options={rowMonitorOptions(row.kind)}
          />
        )}
      </div>
      {row.kind === 'series' && <div className="label-12 mt-1 pl-6 text-gray-900 max-sm:pl-0">{versionsSummary(row, slots)}</div>}
      <ul className="mt-2 flex flex-col gap-1.5 pl-6 max-sm:pl-0">
        {row.files.map((f) => (
          <li key={f.path} className="copy-13 flex flex-wrap items-center gap-2">
            <Checkbox
              checked={f.ticked && !f.left}
              disabled={!!f.left}
              onChange={(e) => patch.mutate({ id: row.id, patch: { files: [{ path: f.path, ticked: e.target.checked }] } })}
              aria-label={`Adopt ${baseName(f.path)}`}
            />
            <Badge variant="teal" contrast="low" size="sm">
              {slots.name(f.slot)}
            </Badge>
            {episodeLabel(f) && (
              <Badge variant="gray" contrast="low" size="sm">
                {episodeLabel(f)}
              </Badge>
            )}
            <span className="copy-13-mono min-w-0 break-all text-gray-900">{baseName(f.path)}</span>
            <span aria-hidden>→</span>
            <span className="copy-13-mono min-w-0 break-all">{baseName(f.to)}</span>
            <span className="text-gray-900">
              {f.profile}, Score {f.score}
            </span>
            {f.subtitles.length > 0 && (
              <span className="text-gray-900">
                + {f.subtitles.length} subtitle{f.subtitles.length === 1 ? '' : 's'}
              </span>
            )}
            {f.action === 'replace' && !f.left && (
              <Badge variant="amber" contrast="low" size="sm">
                Would replace the current file (Score {f.score} vs {f.held_score ?? 0})
              </Badge>
            )}
            {f.left === 'duplicate' && (
              <Badge variant="gray" contrast="low" size="sm">
                Duplicate, left in place
              </Badge>
            )}
            {f.left === 'unmatched' && (
              <Badge variant="gray" contrast="low" size="sm">
                No matching episode, left in place
              </Badge>
            )}
            {f.left === 'path_occupied' && (
              <Badge variant="gray" contrast="low" size="sm">
                Name taken, left in place
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NeedsChoice({ row }: { row: AdoptionRow }) {
  const patch = usePatchRow()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const search = useLookup(query)
  const choose = (tmdb: number) => patch.mutate({ id: row.id, patch: { tmdb_id: tmdb } })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setQuery(q.trim())
  }
  const found = (search.data?.items ?? []).filter((r) => r.kind === row.kind)
  return (
    <div>
      <div className="label-14 flex flex-wrap items-center gap-2 break-all">
        {baseName(row.entry)}{' '}
        <Badge variant="amber" contrast="low" size="sm">
          Needs choice
        </Badge>
      </div>
      {patch.error instanceof ApiError && (
        <Note variant="error" size="small" className="mt-2">
          {patch.error.message}
        </Note>
      )}
      {row.candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.candidates.map((c) => (
            <Button key={c.tmdb_id} variant={c.suggested ? 'primary' : undefined} size="small" onClick={() => choose(c.tmdb_id)} disabled={patch.isPending}>
              {c.suggested ? 'Accept Suggested Match: ' : 'Use '}
              {c.title}
              {c.year ? ` (${c.year})` : ''}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="mt-2 flex max-w-md gap-2">
        <Input
          size="small"
          className="flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={row.kind === 'series' ? 'Search for the Series' : 'Search for the Movie'}
          aria-label={`Search for ${baseName(row.entry)}`}
        />
        <Button size="small" typeName="submit">
          Search
        </Button>
      </form>
      {found.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {found.map((r) => (
            <li key={r.tmdb_id}>
              <Button size="small" onClick={() => choose(r.tmdb_id)} disabled={patch.isPending}>
                Pick {r.title}
                {r.year ? ` (${r.year})` : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

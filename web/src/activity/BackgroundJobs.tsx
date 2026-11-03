// chrome: domain-visual
// Health's Background jobs section: Kestrel's fixed set of loops (ADR 0007) as rows of a table, each with a name and
// what it does, how often it runs, how its last pass went, its last ten runs as bars and a Run Now where a loop may be
// run by hand. The runner keeps this in memory only, so after a restart a loop reads "not run since start" and its bars
// start empty. A loop a setting turns off says which one instead. It stays live through the stream's `jobs` frames. On a
// phone one line says whether all ran fine in the last day and opens onto the list. No design component is a row with
// columns and bars (Table is for plain cells), so the rows are laid out here.
import { Button, StatusDot } from '@hyprsh/design'
import { useState } from 'react'
import { useActivity } from '../api/activity'
import { useJobs, useRunJob, type Job } from '../api/jobs'
import { useSearchStatus } from '../api/search'
import { RunBars } from '../health/RunBars'
import { took } from '../health/runs'
import { SectionBlock } from '../layout/SectionBlock'
import { SkeletonRows } from '../loading'
import { usePhone } from '../responsive'
import { ago, span, useNow } from '../time'
import { useReport } from '../toasts'
import { jobWords } from './jobNames'
import { SearchProgress } from './SearchProgress'
import { useWatchSearch } from './searchToast'
import { useSearchAll } from './useSearchAll'

/** Why a disabled loop does nothing: the switch that turns it off, and where that switch lives. */
const offBecause: Record<NonNullable<Job['disabled_by']>, string> = {
  github_check: 'Off while “Check GitHub for updates” is off in Settings › Updates',
  trash_auto_update: 'Off while “Check TRaSH daily and update automatically” is off in Settings › TRaSH',
  plex_watchlist: 'Off while “Make Requests from Watchlists” is off in Settings › Security',
}

/** How often it runs, short: "1 h", "1 min", "10 s – 5 min" while it has work, "1 d" for the daily loops that check hourly. */
function every(s: Job['schedule']): string {
  if (s.runs_every_ms) return span(s.runs_every_ms)
  if (s.busy_every_ms) return `${span(s.busy_every_ms)} – ${span(s.every_ms)}`
  return span(s.every_ms)
}

type Last = { dot: 'success' | 'error' | 'pending' | 'neutral'; text: string; error: string | null }

/** The dot, the words and the failure of the last run. `since` is when the pass running now started, if the server said. */
function lastRun(j: Job, now: number, since: string | undefined): Last {
  if (j.status === 'running') return { dot: 'pending', text: since ? `running · started ${ago(since, now)}` : 'running', error: null }
  const r = j.last_run
  if (!r) return { dot: 'neutral', text: 'not run since start', error: null }
  const when = ago(r.finished_at, now)
  return r.error ? { dot: 'error', text: `failed · ${took(r.duration_ms)} · ${when}`, error: r.error } : { dot: 'success', text: `ok · ${took(r.duration_ms)} · ${when}`, error: null }
}

function SearchAllWanted() {
  const searchAll = useSearchAll()
  return (
    // A disabled button takes no hover, so the reason sits on the wrapper.
    <span title={searchAll.why}>
      <Button variant="secondary" size="tiny" loading={searchAll.pending} disabled={searchAll.blocked} onClick={searchAll.run}>
        Search All Wanted
      </Button>
    </span>
  )
}

const COLUMNS = 'sm:grid sm:grid-cols-[minmax(0,1.3fr)_88px_minmax(0,1fr)_110px_96px] sm:items-center sm:gap-x-3.5'

function JobRow({ job: j, onOpenTitle }: { job: Job; onOpenTitle?: (id: number) => void }) {
  const run = useRunJob()
  const report = useReport()
  const watch = useWatchSearch()
  const search = useSearchStatus().data
  const activity = useActivity()
  const now = useNow()
  const about = jobWords(j.name)
  const off = j.status === 'disabled'
  const reason = (j.disabled_by && offBecause[j.disabled_by]) ?? 'Off while a setting turns it off'
  const last: Last = off ? { dot: 'neutral', text: 'off', error: null } : lastRun(j, now, activity?.passes.find((p) => p.name === j.name)?.started_at)
  // The Search loop also shows what waits and how the last pass went, and queues every Wanted Version.
  const pipeline = j.name === 'search' ? search : undefined
  const runNow = () =>
    // A search started here is followed in one live Toast instead of a "started" one.
    j.name === 'search'
      ? void report(
          run.mutateAsync(j.name).then(() => watch('Search started')),
          { failed: `Could not run ${about.label}` },
        )
      : void report(run.mutateAsync(j.name), { started: `${about.label} started`, failed: `Could not run ${about.label}` })
  return (
    <li className="border-b border-gray-alpha-200 px-4 py-2.5 text-[13px] last:border-b-0">
      <div className={`flex flex-col gap-1.5 ${COLUMNS}`}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{about.label}</span>
          <span className="label-12 truncate text-gray-900" title={off ? reason : about.does}>
            {off ? reason : about.does}
          </span>
        </span>
        <span className="text-gray-900">
          <span className="sm:hidden">Every </span>
          {every(j.schedule)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <StatusDot state={last.dot} label={false} title={last.text} />
            <span className={last.dot === 'error' ? 'text-red-900' : undefined}>{last.text}</span>
          </span>
          {last.error && (
            <span className="label-12 truncate text-red-900" title={last.error}>
              {last.error}
            </span>
          )}
        </span>
        <RunBars name={about.label} runs={j.recent_runs} />
        <span className="flex sm:justify-end">
          {j.runnable && (
            <Button variant="secondary" size="tiny" aria-label={`Run ${about.label} now`} disabled={j.status === 'running'} onClick={runNow}>
              Run Now
            </Button>
          )}
        </span>
      </div>
      {(j.progress || j.outcome) && !off && (
        <div className="label-12 mt-1.5 flex flex-col gap-0.5 text-gray-900">
          {j.progress && <span>{`Re-scoring: ${j.progress.done} of ${j.progress.total} Titles`}</span>}
          {j.outcome && <span>{j.outcome.text}</span>}
        </div>
      )}
      {pipeline && (
        <div className="label-12 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-gray-900">
          <SearchAllWanted />
          {/* The pass running now is in Running now; here what waits and how the last pass went. */}
          <SearchProgress status={{ ...pipeline, pass: null }} onOpenTitle={onOpenTitle} />
        </div>
      )}
    </li>
  )
}

const DAY = 24 * 3_600_000

/** The names of the jobs with a failed run in the last day. */
function failedInTheLastDay(items: Job[], now: number): string[] {
  return items.filter((j) => j.recent_runs.some((r) => r.error != null && now - Date.parse(r.finished_at) < DAY)).map((j) => jobWords(j.name).label)
}

export function BackgroundJobs({ onOpenTitle }: { onOpenTitle?: (id: number) => void }) {
  const jobs = useJobs()
  const items = jobs.data?.items ?? []
  const phone = usePhone()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const failed = failedInTheLastDay(items, now)
  const list = (
    <ul aria-label="Background jobs" className="rounded-lg border border-gray-alpha-400 max-sm:rounded-none max-sm:border-x-0">
      {!phone && (
        <li aria-hidden className={`label-12 hidden gap-x-3.5 rounded-t-lg bg-background-200 px-4 py-2 text-gray-900 ${COLUMNS}`}>
          <span>Job</span>
          <span>Every</span>
          <span>Last run</span>
          <span>Last 10</span>
          <span />
        </li>
      )}
      {items.map((j) => (
        <JobRow key={j.name} job={j} onOpenTitle={onOpenTitle} />
      ))}
    </ul>
  )
  // Rendered with or without data, so a place can scroll to it.
  return (
    <div>
      <SectionBlock title="Background jobs" count={jobs.data ? items.length : undefined}>
        {jobs.isPending && <SkeletonRows count={4} />}
        {phone ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <StatusDot state={failed.length > 0 ? 'error' : 'success'} label={false} title={failed.length > 0 ? 'Some jobs failed' : 'All ran fine'} />
              <span className="min-w-0 flex-1">{failed.length > 0 ? `${failed.join(', ')} failed in the last day` : 'All ran fine in the last day'}</span>
              <Button variant="tertiary" size="small" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? 'Hide' : 'Show'}
              </Button>
            </div>
            {open && list}
          </div>
        ) : (
          <>
            {list}
            <p className="label-12 mt-2 text-gray-900">Last 10: one bar per run, its height the duration; red runs failed.</p>
          </>
        )}
      </SectionBlock>
    </div>
  )
}

// Activity's Background jobs section: Kestrel's fixed set of loops (ADR 0007), each with what it
// does, how often it runs, how its last pass went and when the next is due. The runner keeps this
// in memory only, so after a restart a loop reads "Not run since start" until its first pass. A loop a
// setting turns off says which one instead. It stays live through the stream's `jobs` frames.
import { SkeletonRows } from '../loading'
import { Badge, Button, Entity, useToasts, type BadgeProps } from '@hyprsh/design'
import { useJobs, useRunJob, type Job } from '../api/jobs'
import { useSearchStatus, type SearchStatus } from '../api/search'
import { useSearchAllWanted } from '../api/wanted'
import { useReport } from '../toasts'
import { SectionBlock } from '../layout/SectionBlock'
import { ago, span, until, useNow } from '../time'
import { jobWords } from './jobNames'
import { SearchProgress } from './SearchProgress'
import { useWatchSearch } from './searchToast'

const statusBadge: Record<Job['status'], { tone: NonNullable<BadgeProps['variant']>; text: string }> = {
  idle: { tone: 'gray', text: 'Idle' },
  running: { tone: 'blue', text: 'Running now' },
  disabled: { tone: 'amber', text: 'Disabled' },
}

/** Why a disabled loop does nothing: the switch that turns it off, and where that switch lives. */
const offBecause: Record<NonNullable<Job['disabled_by']>, string> = {
  github_check: 'Off while “Check GitHub for updates” is off in Settings › Updates',
  trash_auto_update: 'Off while “Check TRaSH daily and update automatically” is off in Settings › TRaSH',
  plex_watchlist: 'Off while “Make Requests from Watchlists” is off in Settings › Security',
}

const hour = 3_600_000

/** "every 5 min", "every minute", "hourly", "daily". */
function often(ms: number): string {
  if (ms === hour) return 'hourly'
  if (ms === 24 * hour) return 'daily'
  return ms === 60_000 ? 'every minute' : `every ${span(ms)}`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The server's schedule in words: "Every 15 min", "Every 10 s while downloading, else 5 min", "Checked hourly, runs daily". */
function schedule(s: Job['schedule'], busy: string): string {
  if (s.runs_every_ms) return `Checked ${often(s.every_ms)}, runs ${often(s.runs_every_ms)}`
  if (s.busy_every_ms) return `${capital(often(s.busy_every_ms))} ${busy}, else ${span(s.every_ms)}`
  return capital(often(s.every_ms))
}

/** "Last run 5 min ago, took 2 s" or "Last run failed 5 min ago: why". */
function lastRun(j: Job, now: number): { text: string; failed: boolean } {
  const r = j.last_run
  if (!r) return { text: 'Not run since start', failed: false }
  if (r.error) return { text: `Last run failed ${ago(r.finished_at, now)}: ${r.error}`, failed: true }
  return { text: `Last run ${ago(r.finished_at, now)}, took ${span(r.duration_ms)}`, failed: false }
}

/** Queues every Wanted Version for a search now, the same action as the command menu's "Search all Wanted". */
function SearchAllWanted({ status }: { status: SearchStatus }) {
  const searchAll = useSearchAllWanted()
  const toasts = useToasts()
  const watch = useWatchSearch()
  const running = status.pass !== null
  // Not gated on what is due now: the point is to search the Wanted Versions that are waiting out their back-off too.
  const blocked = running || searchAll.isPending
  const why = running ? 'A search pass is running' : undefined
  return (
    // A disabled button takes no hover, so the reason sits on the wrapper.
    <span title={why}>
      <Button
        variant="secondary"
        size="small"
        loading={searchAll.isPending}
        disabled={blocked}
        onClick={() =>
          searchAll.mutate(undefined, {
            onSuccess: (versions) => watch(`${versions} Wanted ${versions === 1 ? 'Version' : 'Versions'} queued for a search`),
            onError: (e) => toasts.error(`Search all Wanted failed: ${e.message}`),
          })
        }
      >
        Search all Wanted
      </Button>
    </span>
  )
}

export function BackgroundJobs({ onOpenTitle }: { onOpenTitle?: (id: number) => void }) {
  const jobs = useJobs()
  const items = jobs.data?.items ?? []
  const run = useRunJob()
  const report = useReport()
  const watch = useWatchSearch()
  const search = useSearchStatus().data
  const now = useNow()
  // Rendered with or without data, so a place can scroll to it.
  return (
    <div>
      <SectionBlock title="Background jobs" count={jobs.data ? items.length : undefined}>
        {jobs.isPending && <SkeletonRows count={4} />}
        <Entity.List aria-label="Background jobs">
          {items.map((j) => {
            const about = jobWords(j.name)
            const last = lastRun(j, now)
            const badge = statusBadge[j.status] ?? statusBadge.idle
            const next = j.status === 'idle' && j.next_at ? `Next ${until(j.next_at, now)}` : null
            // The Search loop also shows the search pipeline and queues every Wanted Version.
            const pipeline = j.name === 'search' ? search : undefined
            return (
              <Entity
                key={j.name}
                // On a phone the Search row's buttons go under its progress instead of squeezing it.
                className={pipeline ? 'max-sm:flex-wrap' : undefined}
                rightClassName={pipeline ? 'max-sm:basis-full' : undefined}
                right={
                  (j.runnable || pipeline) && (
                    <div className="flex gap-2">
                      {pipeline && <SearchAllWanted status={pipeline} />}
                      {j.runnable && (
                        <Button
                          variant="secondary"
                          size="small"
                          aria-label={`Run ${about.label} now`}
                          disabled={j.status === 'running'}
                          onClick={() =>
                            // A search started here is followed in one live Toast instead of a "started" one.
                            j.name === 'search'
                              ? void report(
                                  run.mutateAsync(j.name).then(() => watch('Search started')),
                                  { failed: `Could not run ${about.label}` },
                                )
                              : void report(run.mutateAsync(j.name), { started: `${about.label} started`, failed: `Could not run ${about.label}` })
                          }
                        >
                          Run now
                        </Button>
                      )}
                    </div>
                  )
                }
              >
                <Entity.Content
                  fill
                  title={
                    <span className="flex items-center gap-2">
                      {about.label}
                      <Badge variant={badge.tone} contrast="low" size="sm">
                        {badge.text}
                      </Badge>
                    </span>
                  }
                  description={
                    <>
                      {about.does && <div>{about.does}</div>}
                      {j.status === 'disabled' ? (
                        // Its hourly check does nothing, so no schedule, next run or last run to promise.
                        <div>{(j.disabled_by && offBecause[j.disabled_by]) ?? 'Off while a setting turns it off'}</div>
                      ) : (
                        <>
                          <div>{[schedule(j.schedule, about.busy ?? 'while busy'), next].filter(Boolean).join(' · ')}</div>
                          {j.progress && <div>{`Re-scoring: ${j.progress.done} of ${j.progress.total} Titles`}</div>}
                          <div className={last.failed ? 'text-red-900' : undefined}>{last.text}</div>
                          {j.outcome && <div>{j.outcome.text}</div>}
                        </>
                      )}
                      {pipeline && <SearchProgress status={pipeline} onOpenTitle={onOpenTitle} />}
                    </>
                  }
                />
              </Entity>
            )
          })}
        </Entity.List>
      </SectionBlock>
    </div>
  )
}

// Activity's Background jobs section: Kestrel's fixed set of loops (ADR 0007), each with what it
// does, how often it runs, how its last pass went and when the next is due. The runner keeps this
// in memory only, so after a restart a loop reads "Not run since start" until its first pass. A loop a
// setting turns off says which one instead. It stays live through the stream's `jobs` frames.
import { Badge, Button, Note, type BadgeProps } from '@hyprsh/design'
import { useJobs, useRunJob, type Job } from '../api/jobs'
import { ago, span, until, useNow } from '../time'
import { jobWords } from './jobNames'

const statusBadge: Record<Job['status'], { tone: NonNullable<BadgeProps['variant']>; text: string }> = {
  idle: { tone: 'gray-subtle', text: 'Idle' },
  running: { tone: 'blue-subtle', text: 'Running now' },
  disabled: { tone: 'amber-subtle', text: 'Disabled' },
}

/** Why a disabled loop does nothing: the switch that turns it off, and where that switch lives. */
const offBecause: Record<NonNullable<Job['disabled_by']>, string> = {
  github_check: 'Off while “Check GitHub for updates” is off in Settings › Updates',
  trash_auto_update: 'Off while “Check TRaSH daily and update automatically” is off in Settings › TRaSH',
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

export function BackgroundJobs() {
  const items = useJobs().data?.items ?? []
  const run = useRunJob()
  const now = useNow()
  // Rendered with or without data: "/activity/jobs" scrolls here as soon as the screen opens.
  return (
    <section id="activity-jobs" aria-labelledby="activity-jobs-heading" className="flex flex-col">
      <h2 id="activity-jobs-heading" className="label-12-strong px-4 pt-4 pb-1 text-gray-900">
        Background jobs
      </h2>
      <ul>
        {items.map((j) => {
          const about = jobWords(j.name)
          const last = lastRun(j, now)
          const badge = statusBadge[j.status] ?? statusBadge.idle
          const next = j.status === 'idle' && j.next_at ? `Next ${until(j.next_at, now)}` : null
          return (
            <li key={j.name} className="flex items-start gap-3 border-b border-gray-alpha-200 px-4 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{about.label}</h3>
                  <Badge variant={badge.tone} size="sm">{badge.text}</Badge>
                </div>
                {about.does && <div className="label-12 text-gray-900">{about.does}</div>}
                {j.status === 'disabled' ? (
                  // Its hourly check does nothing, so no schedule, next run or last run to promise.
                  <div className="label-12 text-gray-900">{(j.disabled_by && offBecause[j.disabled_by]) ?? 'Off while a setting turns it off'}</div>
                ) : (
                  <>
                    <div className="label-12 text-gray-900">{[schedule(j.schedule, about.busy ?? 'while busy'), next].filter(Boolean).join(' · ')}</div>
                    <div className={last.failed ? 'label-12 text-red-900' : 'label-12 text-gray-900'}>{last.text}</div>
                  </>
                )}
                {run.isError && run.variables === j.name && <Note variant="error">{run.error.message}</Note>}
              </div>
              {j.runnable && (
                <Button variant="secondary" size="small" aria-label={`Run ${about.label} now`} disabled={j.status === 'running'} onClick={() => run.mutate(j.name)}>
                  Run now
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

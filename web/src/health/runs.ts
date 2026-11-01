// A job's recent runs for the run bars: how long a run took in words, how tall its bar is and the text that stands in for the bars.
import type { Job } from '../api/jobs'
import { span } from '../time'

export type JobRun = Job['recent_runs'][number]

/** "0.2 s", "1.4 s", "38 s", "2 min": a run's length; the sub-second ones keep their decimals, which `span` rounds away. */
export function took(ms: number): string {
  if (ms < 100) return '<0.1 s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  return span(ms)
}

/** The tallest and shortest bar, in px. */
export const BAR_MIN = 3
export const BAR_MAX = 18

/** Never scale to less than this, so a row of runs that all take a few milliseconds does not look as long as one of minutes. */
const SCALE_FLOOR_MS = 1000

/** Each run's bar height in px, in proportion to its duration within the row, 3 to 18. */
export function barHeights(runs: JobRun[]): number[] {
  const scale = Math.max(SCALE_FLOOR_MS, ...runs.map((r) => r.duration_ms))
  return runs.map((r) => Math.round(BAR_MIN + (r.duration_ms / scale) * (BAR_MAX - BAR_MIN)))
}

/** What the bars say, for whoever cannot see them: "Search: last 10 runs, oldest first. 9 ok, 1 failed. Took 0.2 s to 1.4 s." */
export function runsLabel(name: string, runs: JobRun[]): string {
  if (runs.length === 0) return `${name}: no runs yet`
  const failed = runs.filter((r) => r.error != null).length
  const durations = runs.map((r) => r.duration_ms)
  const lo = Math.min(...durations)
  const hi = Math.max(...durations)
  const sentence = [`${runs.length - failed} ok`, failed > 0 ? `${failed} failed` : null].filter(Boolean).join(', ')
  return `${name}: last ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, oldest first. ${sentence}. Took ${lo === hi ? took(lo) : `${took(lo)} to ${took(hi)}`}.`
}

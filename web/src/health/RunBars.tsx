// chrome: domain-visual
// A job's last runs as mini bars: one bar per run, oldest first, its height the duration. Only a failed run takes a
// status colour (red); the rest are neutral gray, so the row stays calm. The bars are one image with a text alternative
// (no design component draws a bar sparkline).
import { barHeights, runsLabel, type JobRun } from './runs'

export function RunBars({ name, runs }: { name: string; runs: JobRun[] }) {
  const label = runsLabel(name, runs)
  if (runs.length === 0)
    return (
      <span className="label-12 text-gray-900" title={label}>
        <span aria-hidden>None yet</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  const heights = barHeights(runs)
  return (
    <span role="img" aria-label={label} title={label} className="flex h-[18px] items-end gap-0.5">
      {runs.map((r, i) => (
        <span
          key={`${i}-${r.started_at}`}
          aria-hidden
          data-failed={r.error != null}
          style={{ height: heights[i] }}
          className={`w-[5px] rounded-t-[2px] ${r.error != null ? 'bg-red-700' : 'bg-gray-500'}`}
        />
      ))}
    </span>
  )
}

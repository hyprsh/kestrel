// The download client: its name and connection state, how fast and how long it downloaded, and the speed over the range
// as columns, the same ones as the Grabs chart in the design's single-series colour.
import { ColumnChart } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { StatCard } from '../layout/StatCard'
import { mark, Swatch } from './charts'
import { durationText, periodText, periodWord, rangeName, speedText } from './statsText'

function Figure({ value, label, danger }: { value: string; label: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={`heading-20 ${danger ? 'text-red-900' : ''}`}>{value}</span>
      <span className="label-12 text-gray-900">{label}</span>
    </div>
  )
}

/** "between 12 and 31 MB/s", for the speed chart's label. */
export function speedRange(speeds: number[]): string {
  if (speeds.length === 0) return 'no downloads'
  const lo = Math.min(...speeds)
  const hi = Math.max(...speeds)
  return lo === hi ? `at ${speedText(hi)}` : `between ${speedText(lo)} and ${speedText(hi)}`
}

export function ClientCard({ stats }: { stats: Stats }) {
  const c = stats.download_client
  const columns = c.speed_per_day
  const word = periodWord(stats.range)
  const speeds = columns.flatMap((d) => (d.bytes_per_second === null ? [] : [d.bytes_per_second]))
  const state = c.state === 'ok' ? 'Connected' : c.state === 'failing' ? 'Not connecting' : null
  return (
    <StatCard
      title={c.name ?? 'Download client'}
      label="Download client"
      aside={
        state && (
          <span className="label-12 inline-flex items-center gap-1.5 text-gray-900">
            <Swatch round className={c.state === 'ok' ? mark.imported : mark.failed} />
            {c.state === 'ok' && c.current_bytes_per_second ? `${state} · ${speedText(c.current_bytes_per_second)} now` : state}
          </span>
        )
      }
    >
      {c.state === 'none' ? (
        <p className="label-13 m-0 text-gray-900">No download client is enabled.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Figure value={c.avg_bytes_per_second === null ? '—' : speedText(c.avg_bytes_per_second)} label="average speed" />
            <Figure value={c.median_download_seconds === null ? '—' : durationText(c.median_download_seconds)} label="median download" />
            <Figure value={String(c.completed)} label="completed" />
            <Figure value={String(c.failed)} label="failed in the client" danger={c.failed > 0} />
          </div>
          {speeds.length === 0 ? (
            <p className="label-12 m-0 text-gray-900">Speeds appear once a download has been timed.</p>
          ) : (
            <>
              <ColumnChart
                height={48}
                aria-label={`Average speed per ${word}, ${rangeName(stats.range)}, ${speedRange(speeds)}`}
                series={[{ key: 'speed', label: 'Speed' }]}
                valueFormatter={speedText}
                data={columns.map((d) => ({ label: periodText(d.day, d.to), values: { speed: d.bytes_per_second ?? 0 } }))}
              />
              <span className="label-12 text-gray-900">
                Speed per {word}, {rangeName(stats.range)}
              </span>
            </>
          )}
        </>
      )}
    </StatCard>
  )
}

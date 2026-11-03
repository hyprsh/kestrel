// The download client on a phone, in one line: "SABnzbd: 24 MB/s average · 9 min median · 64 completed · 4 failed".
import type { Stats } from '../api/stats'
import { StatCard } from '../layout/StatCard'
import { durationText, rangeName, speedText } from './statsText'

export function ClientLine({ stats }: { stats: Stats }) {
  const c = stats.download_client
  const parts =
    c.state === 'none'
      ? ['No download client is enabled']
      : [
          c.avg_bytes_per_second === null ? null : `${speedText(c.avg_bytes_per_second)} average`,
          c.median_download_seconds === null ? null : `${durationText(c.median_download_seconds)} median`,
          `${c.completed} completed`,
          `${c.failed} failed`,
          rangeName(stats.range),
        ].filter((p) => p !== null)
  return (
    <StatCard title={c.name ?? 'Download client'} label="Download client">
      <span className="label-13 text-gray-900">{parts.join(' · ')}</span>
    </StatCard>
  )
}

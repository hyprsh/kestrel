// "Library quality" (one 100% bar per Slot, in one hue from dark to light) and "Storage" (one bar per Root folder, and how fast
// the Library grows).
import { Progress } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { plural } from '../format'
import { useSlotNames } from '../library/slots'
import { StatCard } from '../layout/StatCard'
import { ChartTable, Legend, mark, SegmentedBar } from './charts'
import { bytesText } from './statsText'
import { usedPercent } from './Tiles'

const classes = ['Remux / BluRay', 'WEB-DL', 'WEBRip / lower'] as const
const names = ['Remux or BluRay', 'WEB-DL', 'WEBRip or lower']

const pct = (n: number, total: number) => `${Math.round((n / total) * 100)}%`

export function QualityCard({ stats }: { stats: Stats }) {
  const names_ = useSlotNames()
  // Grouped by Slot, in Slot order.
  const slots = names_.order(stats.quality.map((q) => q.slot)).map((s) => stats.quality.find((q) => q.slot === s)!)
  return (
    <StatCard title="Library quality">
      {slots.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No files in the Library yet.</p>
      ) : (
        <>
          {slots.map((q) => {
            const counts = [q.remux_bluray, q.web_dl, q.webrip_or_lower]
            const label = names_.name(q.slot)
            return (
              <div key={q.slot} className="flex flex-col gap-1.5">
                <div className="label-13 flex justify-between">
                  <span className="font-medium">{label}</span>
                  <span className="text-gray-900 tabular-nums">{plural(q.files, 'file')}</span>
                </div>
                <SegmentedBar
                  alternative={`${label}: ${counts.map((n, i) => `${pct(n, q.files)} ${names[i]}`).join(', ')}`}
                  parts={counts.map((n, i) => ({ name: names[i], className: mark.quality[i], n }))}
                />
              </div>
            )
          })}
          <Legend items={classes.map((label, i) => ({ label, className: mark.quality[i] }))} />
          {stats.below_cutoff > 0 && <p className="label-12 m-0 text-gray-900">{`${plural(stats.below_cutoff, 'file')} below their Profile's cutoff: Upgrades wanted.`}</p>}
          <ChartTable caption="Library quality" head={['Slot', 'Files', ...names]} rows={slots.map((q) => [names_.name(q.slot), q.files, q.remux_bluray, q.web_dl, q.webrip_or_lower])} />
        </>
      )}
    </StatCard>
  )
}

/** "Growing ~45 GB a week · Series take 82%": the parts that can be said. Null when none can. */
export function growthLine(s: Stats['storage']): string | null {
  const parts = [s.growth_bytes_per_week !== null && `Growing ~${bytesText(s.growth_bytes_per_week)} a week`, s.series_share !== null && `Series take ${Math.round(s.series_share * 100)}%`].filter(
    Boolean,
  )
  return parts.length ? parts.join(' · ') : null
}

export function StorageCard({ stats }: { stats: Stats }) {
  const { disks } = stats.storage
  const line = growthLine(stats.storage)
  return (
    <StatCard title="Storage">
      {disks.length === 0 ? (
        <p className="label-13 m-0 text-gray-900">No Root folder could be read.</p>
      ) : (
        disks.map((d) => {
          const used = usedPercent(d.free_bytes, d.total_bytes)
          return (
            <div key={d.path} className="flex flex-col gap-1.5">
              <div className="label-13 flex justify-between gap-2">
                <span className="label-12-mono truncate" title={d.path}>
                  {d.path}
                </span>
                <span className="whitespace-nowrap text-gray-900 tabular-nums">{`${bytesText(d.free_bytes)} free of ${bytesText(d.total_bytes)}`}</span>
              </div>
              <Progress value={used} height={8} colors={{ 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-700)' }} aria-label={`${d.path}: ${used}% used`} />
            </div>
          )
        })
      )}
      {line && <span className="label-12 text-gray-900">{line}</span>}
    </StatCard>
  )
}

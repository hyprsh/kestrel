// The Overview's headline figures: Library, Wanted, Grabs in the range, Time to fill and Free space. A phone shows the
// last four (the Library's size is on its own screen).
import { Progress } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { plural } from '../format'
import { StatTile } from '../layout/StatCard'
import { span } from '../time'
import { bytesText, fillDelta, fullInText, grabsTotal, rangeOf } from './statsText'

const value = 'heading-24 max-sm:heading-20'
const note = 'label-12 text-gray-900'

/** The share of the disks that is used, 0 to 100. */
export const usedPercent = (free: number, total: number) => (total > 0 ? Math.round(((total - free) / total) * 100) : 0)

export function Tiles({ stats, phone }: { stats: Stats; phone: boolean }) {
  const { library, wanted, grabs, time_to_fill: fill, storage } = stats
  const total = grabsTotal(stats)
  const delta = fillDelta(fill.median_seconds, fill.previous_median_seconds)
  const used = usedPercent(storage.free_bytes, storage.total_bytes)
  const full = fullInText(storage.months_until_full)
  return (
    <section aria-label="At a glance" className="grid grid-cols-2 gap-3 @3xl:grid-cols-5 max-sm:gap-2.5">
      {!phone && (
        <StatTile label="Library">
          <span className={value}>{plural(library.titles, 'Title')}</span>
          <span className={note}>{[bytesText(library.bytes), plural(library.movies, 'Movie'), `${library.series} Series`].join(' · ')}</span>
        </StatTile>
      )}
      <StatTile label="Wanted">
        <span className={`${value} ${wanted.count > 0 ? 'text-amber-900' : ''}`}>{wanted.count}</span>
        <span className={wanted.long_missing > 0 ? 'label-12 text-red-900' : note}>{wanted.long_missing} Long Missing</span>
      </StatTile>
      <StatTile label={`Grabs · ${rangeOf(stats.range).short}`}>
        <span className={value}>{total}</span>
        <span className={note}>{total === 0 ? 'None finished' : `${Math.round((grabs.imported / total) * 100)}% imported · ${grabs.failed} failed`}</span>
      </StatTile>
      <StatTile label="Time to fill">
        <span className={value}>{fill.median_seconds === null ? '—' : span(fill.median_seconds * 1000)}</span>
        <span className={delta?.faster ? 'label-12 text-green-900' : note}>
          {fill.median_seconds === null ? 'Nothing filled yet' : ['Median, Wanted to Imported', delta?.text].filter(Boolean).join(' · ')}
        </span>
      </StatTile>
      <StatTile label="Free space">
        <span className={value}>{storage.total_bytes > 0 ? bytesText(storage.free_bytes) : '—'}</span>
        {storage.total_bytes > 0 && <Progress value={used} height={6} colors={{ 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-700)' }} aria-label={`${used}% of the disks used`} />}
        <span className={note}>{storage.total_bytes > 0 ? [`${used}% of ${bytesText(storage.total_bytes)} used`, full].filter(Boolean).join(' · ') : 'No Root folder to read'}</span>
      </StatTile>
    </section>
  )
}

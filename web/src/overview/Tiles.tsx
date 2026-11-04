// The Overview's headline figures, as one card split into cells: Library, Wanted, Grabs in the range, Time to fill and Free
// space. A phone shows the last four (the Library's size is on its own screen).
import { Progress } from '@hyprsh/design'
import type { Stats } from '../api/stats'
import { bytesText, plural } from '../format'
import { StatStrip, StatTile } from '../layout/StatCard'
import { placePath } from '../place'
import { span } from '../time'
import { Drill } from './Drill'
import { activityQuery } from './drillDown'
import { fillDelta, fullInText, grabsTotal, rangeOf } from './statsText'

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
    <StatStrip label="At a glance">
      {!phone && (
        <StatTile label="Library">
          <Drill to={placePath('library')} label="Open the Library" className={value}>
            {plural(library.titles, 'Title')}
          </Drill>
          <span className={note}>{[bytesText(library.bytes), plural(library.movies, 'Movie'), `${library.series} Series`].join(' · ')}</span>
        </StatTile>
      )}
      <StatTile label="Wanted">
        <Drill to={placePath('library', 'is:wanted')} label="Open Wanted in the Library" className={value}>
          {wanted.count}
        </Drill>
        <Drill to={placePath('library', 'is:long_missing sort:wanted_since')} label="Open Long Missing in the Library" className={note}>
          {wanted.long_missing} long missing
        </Drill>
      </StatTile>
      <StatTile label={`Grabs · ${rangeOf(stats.range).short}`}>
        {total === 0 ? (
          <>
            <span className={value}>{total}</span>
            <span className={note}>None finished</span>
          </>
        ) : (
          <>
            <Drill to={placePath('activity', activityQuery({ from: stats.from, to: stats.to }))} label="Open These Grabs in Activity" className={value}>
              {total}
            </Drill>
            <span className={note}>
              {`${Math.round((grabs.imported / total) * 100)}% imported · `}
              {grabs.failed > 0 ? (
                <Drill to={placePath('activity', activityQuery({ from: stats.from, to: stats.to, stage: 'failed' }))} label="Open the Failed Grabs in Activity">
                  {`${grabs.failed} failed`}
                </Drill>
              ) : (
                '0 failed'
              )}
            </span>
          </>
        )}
      </StatTile>
      <StatTile label="Time to fill">
        <span className={value}>{fill.median_seconds === null ? '—' : span(fill.median_seconds * 1000)}</span>
        <span className={delta?.faster ? 'label-12 text-green-900' : note}>
          {fill.median_seconds === null ? 'Nothing filled yet' : ['Median, Wanted to Imported', delta?.text].filter(Boolean).join(' · ')}
        </span>
      </StatTile>
      <StatTile label="Free space">
        <span className={value}>{storage.total_bytes > 0 ? bytesText(storage.free_bytes) : '—'}</span>
        {storage.total_bytes > 0 && <Progress value={used} height={4} colors={{ 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-700)' }} aria-label={`${used}% of the disks used`} />}
        <span className={note}>{storage.total_bytes > 0 ? [`${used}% of ${bytesText(storage.total_bytes)} used`, full].filter(Boolean).join(' · ') : 'No Root folder to read'}</span>
      </StatTile>
    </StatStrip>
  )
}

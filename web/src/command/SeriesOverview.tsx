import { ApiError } from '../api/queries'
import type { components } from '../api/schema.gen'
import { ErrorText } from '../forms'
import { seasonName } from '../library/episodes'

export type LookupSeries = components['schemas']['LookupSeries']
type LookupSeason = components['schemas']['LookupSeason']

const statusLabel: Record<string, string> = { continuing: 'Running', ended: 'Ended', upcoming: 'Upcoming' }

/** An air date ("2008-01-20") as "Jan 20, 2008". */
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const year = (d: string) => d.slice(0, 4)

/** A Series' status, network and air dates on one line. */
function SeriesFacts({ series }: { series: LookupSeries }) {
  const aired = series.first_aired ? (series.last_aired && series.last_aired !== series.first_aired ? `${day(series.first_aired)} – ${day(series.last_aired)}` : `since ${day(series.first_aired)}`) : null
  const facts = [series.status ? (statusLabel[series.status] ?? series.status) : null, series.network, aired].filter(Boolean)
  if (facts.length === 0) return null
  return <p className="text-gray-900">{facts.join(' · ')}</p>
}

/**
 * The Series overview's line in the add panel: loading until TheTVDB answers,
 * its own error when that fails (the rest of the panel stays usable), then the
 * status, network and air dates.
 */
export function SeriesOverviewLine({ overview }: { overview: { data?: LookupSeries | null; isPending: boolean; error: Error | null } }) {
  if (overview.error) {
    return <ErrorText>Could not load the series overview{overview.error instanceof ApiError ? `: ${overview.error.message}` : '.'}</ErrorText>
  }
  if (overview.isPending) return <p className="text-gray-900">Loading the series overview…</p>
  return overview.data ? <SeriesFacts series={overview.data} /> : null
}

function seasonAired(s: LookupSeason) {
  if (!s.first_aired) return 'not aired yet'
  const from = year(s.first_aired)
  const to = s.last_aired ? year(s.last_aired) : from
  return from === to ? from : `${from}–${to}`
}

/**
 * Every season with its episode count and air years. When `ticked` is given
 * each season has a checkbox saying whether it is monitored at add.
 */
export function SeasonList({ series, ticked, onToggle }: { series: LookupSeries; ticked: number[] | null; onToggle: (season: number) => void }) {
  if (series.seasons.length === 0) return null
  return (
    <ul aria-label="Seasons" className="mt-2 flex flex-col rounded-md border border-gray-alpha-400 py-1 text-[12px]">
      {series.seasons.map((s) => (
        <li key={s.number} className="flex h-7 items-center gap-2 px-3">
          {ticked && <input type="checkbox" aria-label={seasonName(s.number)} checked={ticked.includes(s.number)} onChange={() => onToggle(s.number)} />}
          <span className="w-20 font-medium">{seasonName(s.number)}</span>
          <span className="w-24 text-gray-900">
            {s.episodes} {s.episodes === 1 ? 'episode' : 'episodes'}
          </span>
          <span className="text-gray-900">{seasonAired(s)}</span>
        </li>
      ))}
    </ul>
  )
}

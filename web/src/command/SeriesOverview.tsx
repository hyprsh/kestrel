import { ApiError } from '../api/queries'
import type { components } from '../api/schema.gen'
import { Checkbox, Note, Table, type TableColumn } from '@hyprsh/design'
import { seasonName } from '../library/episodes'
import { Loading } from './Loading'

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
  return <p className="label-13 text-gray-900">{facts.join(' · ')}</p>
}

/**
 * The Series overview's line in the add panel: loading until TheTVDB answers,
 * its own error when that fails (the rest of the panel stays usable), then the
 * status, network and air dates.
 */
export function SeriesOverviewLine({ overview }: { overview: { data?: LookupSeries | null; isPending: boolean; error: Error | null } }) {
  if (overview.error) {
    return (
      <Note variant="error" size="small">
        Could not load the series overview{overview.error instanceof ApiError ? `: ${overview.error.message}` : '.'}
      </Note>
    )
  }
  if (overview.isPending) return <Loading>Loading the series overview…</Loading>
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
  const columns: TableColumn<LookupSeason & { id: number }>[] = [
    ...(ticked
      ? [{ key: 'monitored', header: 'Monitored', render: (s: LookupSeason) => <Checkbox aria-label={seasonName(s.number)} checked={ticked.includes(s.number)} onChange={() => onToggle(s.number)} /> }]
      : []),
    { key: 'season', header: 'Season', render: (s) => seasonName(s.number) },
    { key: 'episodes', header: 'Episodes', render: (s) => `${s.episodes} ${s.episodes === 1 ? 'episode' : 'episodes'}` },
    { key: 'aired', header: 'Aired', render: seasonAired },
  ]
  return (
    <div className="mt-2">
      <Table caption="Seasons" columns={columns} rows={series.seasons.map((s) => ({ ...s, id: s.number }))} />
    </div>
  )
}

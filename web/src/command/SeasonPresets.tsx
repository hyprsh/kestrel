import type { TitleCreate } from '../api/queries'
import { Select } from '../forms'
import { SeasonList, type LookupSeries } from './SeriesOverview'

/**
 * How a Series starts: a monitoring mode alone, or seasons monitored at add
 * with the mode for what arrives later.
 */
export type Preset = 'all' | 'future' | 'none' | 'first' | 'latest' | 'pick'

/** A preset with the seasons ticked under Pick… and whether new seasons are followed. */
export type SeasonChoice = { preset: Preset; picked: number[]; follow: boolean }

export const allEpisodes: SeasonChoice = { preset: 'all', picked: [], follow: true }

/** The seasons a choice monitors at add; null when the mode alone decides. */
export function seasonsOf(c: SeasonChoice, series: LookupSeries | null): number[] | null {
  switch (c.preset) {
    case 'first':
      return [1]
    case 'latest':
      return series?.latest_season ? [series.latest_season] : []
    case 'pick':
      return [...c.picked].sort((a, b) => a - b)
  }
  return null
}

/** The rule for episodes that arrive later. */
function modeOf(c: SeasonChoice): NonNullable<TitleCreate['series_monitor']> {
  switch (c.preset) {
    case 'first':
      return 'none'
    case 'latest':
      return 'future'
    case 'pick':
      return c.follow ? 'future' : 'none'
  }
  return c.preset
}

/** What a choice adds to POST /titles. */
export function seasonBody(c: SeasonChoice, series: LookupSeries | null): Pick<TitleCreate, 'series_monitor' | 'seasons'> {
  const seasons = seasonsOf(c, series)
  return seasons ? { series_monitor: modeOf(c), seasons } : { series_monitor: modeOf(c) }
}

/** Switches to Pick…, starting from what the current choice monitors at add. */
function pick(c: SeasonChoice, series: LookupSeries | null): SeasonChoice {
  return c.preset === 'pick' ? c : { preset: 'pick', picked: seasonsOf(c, series) ?? [], follow: modeOf(c) !== 'none' }
}

/**
 * The Monitor choice for a Series being added: All, Future and None as
 * before, First season, Latest season and Pick…, with the season list showing
 * what is monitored at add. Ticking a season switches to Pick….
 */
export function SeasonPresets({ choice, onChange, series }: { choice: SeasonChoice; onChange: (c: SeasonChoice) => void; series: LookupSeries | null }) {
  const has = (n: number) => !!series?.seasons.some((s) => s.number === n)
  const toggle = (n: number) => {
    const p = pick(choice, series)
    onChange({ ...p, picked: p.picked.includes(n) ? p.picked.filter((x) => x !== n) : [...p.picked, n] })
  }
  return (
    <>
      <label className="mt-3 flex items-center gap-3 text-[13px]">
        <span className="w-20 font-medium">Monitor</span>
        <Select
          aria-label="Monitor"
          value={choice.preset}
          onChange={(e) => {
            const preset = e.target.value as Preset
            onChange(preset === 'pick' ? pick(choice, series) : { ...choice, preset })
          }}
          className="max-w-56"
        >
          <option value="all">All episodes</option>
          <option value="future">Future episodes only</option>
          <option value="none">None</option>
          <option value="first" disabled={!has(1)}>
            First season
          </option>
          <option value="latest" disabled={!series?.latest_season}>
            Latest season{series?.latest_season ? ` (${series.latest_season})` : ''}
          </option>
          <option value="pick" disabled={!series}>
            Pick seasons…
          </option>
        </Select>
      </label>
      {choice.preset === 'pick' && (
        <label className="mt-2 ml-[92px] flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={choice.follow} onChange={(e) => onChange({ ...choice, follow: e.target.checked })} />
          Follow new seasons
        </label>
      )}
      {series && <SeasonList series={series} ticked={seasonsOf(choice, series)} onToggle={toggle} />}
    </>
  )
}

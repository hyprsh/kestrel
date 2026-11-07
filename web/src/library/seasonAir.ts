import type { Episode } from '../api/queries'
import { weekdayDay } from './cellDetail'

/** A season's air pill, from its episodes' air dates (episode on `now`'s day still to come). */
export type SeasonAir = { text: string; tone: 'blue' | 'gray' }

/**
 * "Next Thu, Nov 12" while a season is airing, "Starts Tue, Dec 1" while nothing in it has aired, and, for the Series' `latest` season
 * only, "Airing" while it has episodes with no date yet and "Finished" once every episode has aired. Null for an older season that has
 * aired, and for one with no air dates at all.
 */
export function seasonAir(eps: Episode[], now: number, latest: boolean): SeasonAir | null {
  if (eps.length === 0) return null
  const today = new Date(now).toISOString().slice(0, 10)
  const dated = eps.map((e) => e.air_date).filter((d): d is string => !!d)
  const aired = dated.filter((d) => d < today).length
  const next = dated.filter((d) => d >= today).sort()[0]
  const undated = eps.length - dated.length
  if (dated.length === 0) return null
  const when = next && (next === today ? 'today' : weekdayDay(next))
  if (aired === 0) return { text: `Starts ${when}`, tone: 'blue' }
  if (next) return { text: `Next ${when}`, tone: 'blue' }
  if (!latest) return null
  return undated > 0 ? { text: 'Airing', tone: 'blue' } : { text: 'Finished', tone: 'gray' }
}

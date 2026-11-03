// How episodes and seasons read in the UI, and the types the episode grid's
// actions (EpisodeActions.tsx, DeleteFiles.tsx) share.
import type { Episode } from '../api/queries'
import type { Display } from '../display/useDisplay'
import { cellOf } from './slots'

const two = (n: number) => String(n).padStart(2, '0')

/** "S01E03": how an episode reads in a scope label or the Log. */
export const episodeCode = (e: Episode) => `S${two(e.season)}E${two(e.number)}`

/** "Specials" or "Season 2". */
export const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/**
 * The seasons in the order the household reads them: oldest first or newest first. Specials (season 0) come before
 * Season 1 oldest first, and last newest first.
 */
export function orderSeasons(seasons: number[], order: Display['season_order']): number[] {
  const regular = seasons.filter((s) => s !== 0).sort((a, b) => (order === 'newest_first' ? b - a : a - b))
  if (!seasons.includes(0)) return regular
  return order === 'newest_first' ? [...regular, 0] : [0, ...regular]
}

/** The episodes in the shown order: seasons as `orderSeasons` has them, and newest first reverses the episodes in each. */
export function orderEpisodes(episodes: Episode[], order: Display['season_order']): Episode[] {
  const bySeason = new Map<number, Episode[]>()
  for (const e of episodes) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e])
  return orderSeasons([...bySeason.keys()], order).flatMap((s) => {
    const eps = (bySeason.get(s) ?? []).slice().sort((a, b) => a.number - b.number)
    return order === 'newest_first' ? eps.reverse() : eps
  })
}

/** The episode grid's row of an episode, or of a season: where a question asked from its menu shows. */
export const episodeRow = (id: number) => `episode-${id}`
export const seasonRow = (season: number) => `season-${season}`

/** One of the Series' Versions as the episode grid's actions see it. */
export type EpisodeVersion = { id: number; slot: string; /** The Slot's label. */ slotName: string; profileName: string }

/** How a season stands, for its tab and summary line. An episode counts once: filled when every Slot has its file, else downloading or Wanted when a Slot is. */
export type SeasonStanding = { total: number; filled: number; downloading: number; wanted: number }

export function seasonStanding(episodes: Episode[], slots: readonly string[]): SeasonStanding {
  const states = (e: Episode) => slots.map((s) => cellOf(e, s)?.state)
  return {
    total: episodes.length,
    filled: episodes.filter((e) => states(e).length > 0 && states(e).every((s) => s === 'filled')).length,
    downloading: episodes.filter((e) => states(e).includes('downloading')).length,
    wanted: episodes.filter((e) => states(e).includes('wanted')).length,
  }
}

/** The episodes of each season, in the order of `episodes`. */
export function bySeason(episodes: Episode[]): Map<number, Episode[]> {
  const out = new Map<number, Episode[]>()
  for (const e of episodes) out.set(e.season, [...(out.get(e.season) ?? []), e])
  return out
}

/**
 * The seasons a Series' Title page opens on, given the seasons with something Wanted. With `latest_and_wanted` (Settings' "Open the
 * newest season") that is the newest season (Specials when that is all it has) and every Wanted one. Otherwise it is the first season
 * with something Wanted, or the first season when nothing is: the lowest numbered one, Specials only when that is all. `none` opens nothing.
 */
export function defaultSeasons(seasons: number[], wanted: number[], open: Display['seasons_open'] = 'latest_and_wanted'): number[] {
  if (open === 'latest_and_wanted') return [...new Set([Math.max(0, ...seasons), ...wanted])]
  if (open === 'none') return []
  if (wanted.length > 0) return [wanted[0]]
  const regular = seasons.filter((s) => s !== 0)
  return [regular.length > 0 ? Math.min(...regular) : 0]
}

type CellState = NonNullable<ReturnType<typeof cellOf>>['state']

/** How one Slot stands in a season: a state per episode (the squares of the season grid) and the counts the row says in words. */
export type SlotTally = { slot: string; states: CellState[]; filled: number; downloading: number; wanted: number; unaired: number; unmonitored: number; counted: number }

/** `counted` is what the fill count measures against: the episodes out and monitored. */
export function slotTally(episodes: Episode[], slot: string): SlotTally {
  const states = episodes.map((e) => cellOf(e, slot)?.state ?? 'unmonitored')
  const n = (s: CellState) => states.filter((x) => x === s).length
  return {
    slot,
    states,
    filled: n('filled'),
    downloading: n('downloading'),
    wanted: n('wanted'),
    unaired: n('unreleased'),
    unmonitored: n('unmonitored'),
    counted: states.length - n('unreleased') - n('unmonitored'),
  }
}

/** The tally as a short count: "8/10", "12/13 · 1 Wanted", or "not monitored" when the season holds nothing to count. */
export function tallyCount(t: SlotTally): string {
  if (t.counted === 0 && t.filled === 0) return t.unaired > 0 && t.unmonitored === 0 ? 'not aired' : 'not monitored'
  return `${t.filled}/${t.counted}${t.wanted > 0 ? ` · ${t.wanted} Wanted` : ''}`
}

/** The filters of the open season's table. */
export type EpisodeFilter = 'all' | 'missing' | 'downloading' | 'unaired'

const statesOf = (e: Episode, slots: readonly string[]) => slots.map((s) => cellOf(e, s)?.state)

/** Whether an episode shows under a filter: Missing is Wanted in some Slot, Downloading is downloading in some Slot, Not aired is not out in some Slot. */
export function matchesFilter(e: Episode, slots: readonly string[], filter: EpisodeFilter): boolean {
  const states = statesOf(e, slots)
  switch (filter) {
    case 'missing':
      return states.includes('wanted')
    case 'downloading':
      return states.includes('downloading')
    case 'unaired':
      return states.includes('unreleased')
    default:
      return true
  }
}

/** An episode that is not out in any Slot yet: the table folds these into one row. */
export const isUnaired = (e: Episode, slots: readonly string[]) => {
  const states = statesOf(e, slots).filter((s) => s !== undefined)
  return states.length > 0 && states.every((s) => s === 'unreleased')
}

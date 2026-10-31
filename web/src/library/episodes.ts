// How episodes and seasons read in the UI, and the types the episode grid's
// actions (EpisodeActions.tsx, DeleteFiles.tsx) share.
import type { Episode } from '../api/queries'
import type { Display } from '../display/useDisplay'
import type { SlotKey } from './bits'

const two = (n: number) => String(n).padStart(2, '0')

/** "S01E03": how an episode reads in a scope label or the Log. */
export const episodeCode = (e: Episode) => `S${two(e.season)}E${two(e.number)}`

/** "Specials" or "Season 2". */
export const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/**
 * The seasons in the order the household reads them: oldest first or newest first, with Specials (season 0)
 * last in both.
 */
export function orderSeasons(seasons: number[], order: Display['season_order']): number[] {
  const regular = seasons.filter((s) => s !== 0).sort((a, b) => (order === 'newest_first' ? b - a : a - b))
  return seasons.includes(0) ? [...regular, 0] : regular
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
export type EpisodeVersion = { id: number; slot: SlotKey; profileName: string }

/** How a season stands, for its tab and summary line. An episode counts once: filled when every Slot has its file, else downloading or Wanted when a Slot is. */
export type SeasonStanding = { total: number; filled: number; downloading: number; wanted: number }

export function seasonStanding(episodes: Episode[], slots: SlotKey[]): SeasonStanding {
  const states = (e: Episode) => slots.map((s) => e.cells[s]?.state)
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

/** The season a Series' Title page opens on: the latest one, or Specials when that is all it has. */
export const defaultSeason = (seasons: number[]): number => Math.max(0, ...seasons)

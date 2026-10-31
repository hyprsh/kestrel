// Reading an episode code the way a person types it: `s2e5`, `S02E05` and `2x05` name an episode, `s2` a
// season. The Title page's "Find an episode" field uses it, and so can the Library filter ("harbour s2e5"):
// `splitCode` cuts a query into the name and the code behind it.
import type { Episode } from '../api/queries'
import { episodeCode } from './episodes'

/** A season, and within it an episode (`episode` is null for a bare season such as `s2`). Season 0 is Specials. */
export type EpisodeRef = { season: number; episode: number | null }

const patterns: [RegExp, (m: RegExpExecArray) => EpisodeRef][] = [
  [/^s(\d{1,3})e(\d{1,4})$/i, (m) => ({ season: Number(m[1]), episode: Number(m[2]) })],
  [/^(\d{1,3})x(\d{1,4})$/i, (m) => ({ season: Number(m[1]), episode: Number(m[2]) })],
  [/^s(\d{1,3})$/i, (m) => ({ season: Number(m[1]), episode: null })],
]

/** The season or episode a single token such as `s2e5`, `S02E05`, `2x05` or `s2` names, or null when it is not a code. */
export function parseCode(token: string): EpisodeRef | null {
  const text = token.trim()
  for (const [re, make] of patterns) {
    const m = re.exec(text)
    if (m) return make(m)
  }
  return null
}

/**
 * Cuts a query into a name and the code that ends it: "harbour s2e5" is `{ name: 'harbour', ref: {season: 2, episode: 5} }`.
 * A query that is only a code, or has no code at its end, is null: a bare code names no Series.
 */
export function splitCode(query: string): { name: string; ref: EpisodeRef } | null {
  const text = query.trim()
  const at = text.lastIndexOf(' ')
  if (at < 0) return null
  const ref = parseCode(text.slice(at + 1))
  const name = text.slice(0, at).trim()
  return ref && name ? { name, ref } : null
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')

/**
 * The episodes `text` finds in one Series, in the order given: those a code names (a bare season names all of its
 * episodes), else those whose name holds the text, whether the Primary Language or the original one.
 */
export function findEpisodes(episodes: Episode[], text: string): Episode[] {
  const q = text.trim()
  if (!q) return []
  const ref = parseCode(q)
  if (ref) return episodes.filter((e) => e.season === ref.season && (ref.episode === null || e.number === ref.episode))
  const needle = fold(q)
  return episodes.filter((e) => [e.primary_name, e.original_name, e.name, episodeCode(e)].some((n) => n && fold(n).includes(needle)))
}

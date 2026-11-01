import type { Episode, EpisodeScope } from '../api/queries'

const two = (n: number) => String(n).padStart(2, '0')

/** The code of a search's scope for the address: "S05" for a season, "S05E07,E08" for episodes of it, null for the whole Title. */
export function scopeCode(body: EpisodeScope | undefined, episodes: Episode[]): string | null {
  if (body?.season === undefined) return null
  const season = `S${two(body.season)}`
  if (!body.episode_ids?.length) return season
  const numbers = body.episode_ids.map((id) => episodes.find((e) => e.id === id)?.number).filter((n): n is number => n !== undefined)
  return numbers.length === 0 ? season : `${season}E${numbers.map(two).join(',E')}`
}

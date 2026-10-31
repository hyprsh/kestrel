// The Episode and Season rows the Library shows above its Titles when the filter names a Title and an episode code or a
// season ("harbour s2e5", "harbour s2"). The list rows carry no episodes, so the episodes (and Versions) of only the
// Series the name matches are fetched, a few at most, through the Title page's own queries, so the page finds them cached.
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { episodesQuery, titleQuery, useProfiles, type Episode, type TitleRow } from '../api/queries'
import { slotKeys } from './bits'
import { versionsOf } from './EpisodeActions'
import { splitCode } from './episodeCode'
import type { EpisodeVersion } from './episodes'

/** The most Series whose episodes a filter fetches. */
const most = 5

/** One result: an episode of a Series, or a whole season of it. */
export type EpisodeHit = {
  key: string
  kind: 'episode' | 'season'
  title: TitleRow
  season: number
  /** The episode, for an episode result. */
  episode: Episode | null
  /** The episodes it covers: the episode itself, or every episode of the season. */
  episodes: Episode[]
  versions: EpisodeVersion[]
}

const none: EpisodeHit[] = []

/** The results for the filter's free `text` over the Series among `rows`: episodes first, then seasons, each in the list's order. */
export function useEpisodeResults(rows: readonly TitleRow[], text: string, enabled = true): EpisodeHit[] {
  const ref = useMemo(() => (enabled ? (splitCode(text)?.ref ?? null) : null), [enabled, text])
  const series = useMemo(() => (ref ? rows.filter((r) => r.kind === 'series').slice(0, most) : []), [ref, rows])
  const profiles = useProfiles().data
  const titles = useQueries({ queries: series.map((r) => titleQuery(r.id)) })
  const episodes = useQueries({ queries: series.map((r) => episodesQuery(r.id)) })
  const stamp = [...titles, ...episodes].map((q) => q.dataUpdatedAt).join()
  return useMemo(() => {
    if (!ref || series.length === 0) return none
    const forEpisodes: EpisodeHit[] = []
    const forSeasons: EpisodeHit[] = []
    series.forEach((title, i) => {
      const detail = titles[i].data
      const all = episodes[i].data
      if (!detail || !all) return
      const versions = versionsOf(
        detail,
        slotKeys.filter((k) => detail.versions.some((v) => v.slot === k)),
        profiles,
      )
      const inSeason = all.filter((e) => e.season === ref.season).sort((a, b) => a.number - b.number)
      const episode = ref.episode === null ? undefined : inSeason.find((e) => e.number === ref.episode)
      if (episode) forEpisodes.push({ key: `episode-${episode.id}`, kind: 'episode', title, season: ref.season, episode, episodes: [episode], versions })
      if (inSeason.length > 0) forSeasons.push({ key: `season-${title.id}-${ref.season}`, kind: 'season', title, season: ref.season, episode: null, episodes: inSeason, versions })
    })
    return [...forEpisodes, ...forSeasons]
    // `stamp` stands for the fetched data: the query results are new arrays on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, series, stamp, profiles])
}

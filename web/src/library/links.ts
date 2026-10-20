/** Where a Title lives on the metadata sites. Pure, so any screen that knows an id can link it. */

import type { components } from '../api/schema.gen'

type Kind = components['schemas']['TitleKind']

export const tmdbUrl = (kind: Kind, id: number) => `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${id}`

export const imdbUrl = (id: string) => `https://www.imdb.com/title/${id}/`

/** TheTVDB's dereferrer redirects an id to the series page, so no slug is needed. */
export const tvdbUrl = (id: number) => `https://thetvdb.com/dereferrer/series/${id}`

export type TitleLink = { label: string; href: string }

/** A Title's ids as links, in TMDB, IMDb, TheTVDB order; missing ids, and TheTVDB for a Movie, are left out. */
export function titleLinks(t: { kind: Kind; tmdb_id?: number | null; imdb_id?: string | null; tvdb_id?: number | null }): TitleLink[] {
  const links: TitleLink[] = []
  if (t.tmdb_id) links.push({ label: `TMDB ${t.tmdb_id}`, href: tmdbUrl(t.kind, t.tmdb_id) })
  if (t.imdb_id) links.push({ label: t.imdb_id, href: imdbUrl(t.imdb_id) })
  if (t.tvdb_id && t.kind === 'series') links.push({ label: `TVDB ${t.tvdb_id}`, href: tvdbUrl(t.tvdb_id) })
  return links
}

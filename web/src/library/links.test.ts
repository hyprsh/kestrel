import { describe, expect, it } from 'vitest'
import { imdbUrl, titleLinks, tmdbUrl, tvdbUrl } from './links'

describe('external Title links', () => {
  it('points TMDB at /movie/ for a Movie and /tv/ for a Series', () => {
    expect(tmdbUrl('movie', 949)).toBe('https://www.themoviedb.org/movie/949')
    expect(tmdbUrl('series', 1668)).toBe('https://www.themoviedb.org/tv/1668')
  })

  it('points IMDb at the title page and TheTVDB at its dereferrer', () => {
    expect(imdbUrl('tt0108778')).toBe('https://www.imdb.com/title/tt0108778/')
    expect(tvdbUrl(79168)).toBe('https://thetvdb.com/dereferrer/series/79168')
  })

  it('lists a Series’ ids in TMDB, IMDb, TheTVDB order', () => {
    expect(titleLinks({ kind: 'series', tmdb_id: 1668, imdb_id: 'tt0108778', tvdb_id: 79168 })).toEqual([
      { label: 'TMDB 1668', href: 'https://www.themoviedb.org/tv/1668' },
      { label: 'tt0108778', href: 'https://www.imdb.com/title/tt0108778/' },
      { label: 'TVDB 79168', href: 'https://thetvdb.com/dereferrer/series/79168' },
    ])
  })

  it('leaves out ids the Title does not have, and TheTVDB for a Movie', () => {
    expect(titleLinks({ kind: 'movie', tmdb_id: 949, imdb_id: null, tvdb_id: 1234 })).toEqual([
      { label: 'TMDB 949', href: 'https://www.themoviedb.org/movie/949' },
    ])
    expect(titleLinks({ kind: 'series', tmdb_id: null, imdb_id: null, tvdb_id: null })).toEqual([])
  })
})

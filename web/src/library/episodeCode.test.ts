import { describe, expect, it } from 'vitest'
import { episode } from '../test/series'
import { findEpisodes, parseCode, splitCode } from './episodeCode'

describe('parseCode', () => {
  it.each([
    ['s2e5', { season: 2, episode: 5 }],
    ['S02E05', { season: 2, episode: 5 }],
    ['2x05', { season: 2, episode: 5 }],
    ['2X5', { season: 2, episode: 5 }],
    ['s0e1', { season: 0, episode: 1 }],
    ['s2', { season: 2, episode: null }],
    [' S10E123 ', { season: 10, episode: 123 }],
  ])('reads %s', (text, ref) => expect(parseCode(text)).toEqual(ref))

  it.each(['', 'harbour', 's', 'e5', 's2e', '2x', '12', 's2e5x', 'season 2'])('does not read %j', (text) => expect(parseCode(text)).toBeNull())
})

describe('splitCode', () => {
  it('cuts a code off the end of a name', () => {
    expect(splitCode('harbour s2e5')).toEqual({ name: 'harbour', ref: { season: 2, episode: 5 } })
    expect(splitCode('harbour lights 2x05')).toEqual({ name: 'harbour lights', ref: { season: 2, episode: 5 } })
    expect(splitCode('harbour s2')).toEqual({ name: 'harbour', ref: { season: 2, episode: null } })
  })

  it('matches nothing for a bare code or a query with no code', () => {
    expect(splitCode('s2e5')).toBeNull()
    expect(splitCode('harbour')).toBeNull()
    expect(splitCode('s2e5 harbour')).toBeNull()
    expect(splitCode('  ')).toBeNull()
  })
})

describe('findEpisodes', () => {
  const eps = [
    episode(1, 1, 1, 'Pilot'),
    episode(2, 1, 5, 'Gray Matter'),
    episode(3, 2, 5, 'Breakage'),
    episode(4, 2, 6, 'Peekaboo', { primary_name: 'Guck-guck', original_name: 'Peekaboo' }),
  ]

  it('finds the episode a code names, in any spelling', () => {
    for (const q of ['s2e5', '2x05', 'S02E05']) expect(findEpisodes(eps, q).map((e) => e.id)).toEqual([3])
  })

  it('finds every episode of a bare season', () => {
    expect(findEpisodes(eps, 's2').map((e) => e.id)).toEqual([3, 4])
  })

  it('finds part of a name, in either language and ignoring case and accents', () => {
    expect(findEpisodes(eps, 'GRAY').map((e) => e.id)).toEqual([2])
    expect(findEpisodes(eps, 'guck').map((e) => e.id)).toEqual([4])
    expect(findEpisodes(eps, 'peek').map((e) => e.id)).toEqual([4])
  })

  it('finds nothing for an empty field or an unknown code', () => {
    expect(findEpisodes(eps, '  ')).toEqual([])
    expect(findEpisodes(eps, 's9e9')).toEqual([])
  })
})

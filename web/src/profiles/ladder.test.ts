import { describe, expect, it } from 'vitest'
import { cardLadder, fromGb, moved, qualityLabel, sameLadder, sizeFacts, sizeRange, toGb, upgradeFact, type ProfileOverlay } from './ladder'

const GB = 1024 ** 3
const overlay = (over: Partial<ProfileOverlay> = {}): ProfileOverlay => ({
  min_score: null,
  upgrade_until: null,
  series: { cutoff: null, qualities: null },
  movies: { cutoff: null, qualities: null },
  episode_size: { min: null, max: null },
  movie_size: { min: null, max: null },
  ...over,
})

describe('Profile ladder words', () => {
  it('names a quality the way the Profile pages do', () => {
    expect(qualityLabel('WEBDL-2160p')).toBe('WEB-DL 2160p')
    expect(qualityLabel('WEBRip-1080p')).toBe('WEBRip 1080p')
    expect(qualityLabel('Bluray-1080p')).toBe('BluRay 1080p')
    expect(qualityLabel('Remux-1080p')).toBe('Remux 1080p')
    expect(qualityLabel('Bluray-2160p Remux')).toBe('Remux 2160p')
    expect(qualityLabel('HDTV-720p')).toBe('HDTV 720p')
    expect(qualityLabel('SDTV')).toBe('SDTV')
    expect(qualityLabel('Raw-HD')).toBe('Raw-HD')
  })

  it('reads and writes sizes in GB', () => {
    expect(toGb(10 * GB)).toBe('10')
    expect(toGb(GB / 2)).toBe('0.5')
    expect(toGb(null)).toBe('')
    expect(fromGb('2')).toBe(2 * GB)
    expect(fromGb('0,5')).toBe(GB / 2)
    expect([fromGb(''), fromGb('x'), fromGb('0'), fromGb('-1')]).toEqual([null, null, null, null])
  })

  it('words a size range and the facts of a Profile', () => {
    expect(sizeRange({ min: GB, max: 10 * GB })).toBe('1 – 10 GB')
    expect(sizeRange({ min: null, max: 3 * GB })).toBe('up to 3 GB')
    expect(sizeRange({ min: GB, max: null })).toBe('from 1 GB')
    expect(sizeRange({ min: null, max: null })).toBeNull()
    expect(sizeFacts(overlay({ episode_size: { min: GB, max: 10 * GB }, movie_size: { min: null, max: 40 * GB } }))).toEqual(['1 – 10 GB per episode', 'up to 40 GB per Movie'])
    expect(sizeFacts(overlay())).toEqual([])
  })

  it('says where Upgrades stop', () => {
    expect(upgradeFact(overlay({ upgrade_until: 2000 }), 'WEBDL-1080p')).toBe('Upgrade until Score 2,000')
    expect(upgradeFact(overlay(), 'WEBDL-1080p')).toBe('No Upgrades past the cutoff')
    expect(upgradeFact(overlay(), null)).toBe('Upgrades never stop')
  })

  it('moves an item, and ignores moves off either end', () => {
    expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
    const list = ['a', 'b']
    expect(moved(list, 0, -1)).toBe(list)
    expect(moved(list, 1, 2)).toBe(list)
  })

  it('compares ladders by order and ticks, and shows the ones TRaSH accepts that were turned off on the card', () => {
    const a = [
      { name: 'x', accepted: true },
      { name: 'y', accepted: false },
    ]
    expect(sameLadder(a, [...a])).toBe(true)
    expect(sameLadder(a, [a[1], a[0]])).toBe(false)
    expect(
      sameLadder(a, [
        { name: 'x', accepted: true },
        { name: 'y', accepted: true },
      ]),
    ).toBe(false)
    const trash = [
      { name: 'x', accepted: true },
      { name: 'y', accepted: true },
      { name: 'z', accepted: false },
    ]
    const mine = [
      { name: 'x', accepted: true },
      { name: 'y', accepted: false },
      { name: 'z', accepted: false },
    ]
    expect(cardLadder(mine, trash).map((q) => q.name)).toEqual(['x', 'y'])
  })
})

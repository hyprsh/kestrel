import { describe, expect, it } from 'vitest'
import type { Release } from '../api/grabs'
import { ageLong, ageShort, coverRange, deltaText, rejectedSummary, signed, whyLine } from './releaseView'

const rel = (over: Partial<Release> = {}): Release => ({
  release_id: 'x',
  name: 'x',
  indexer: 'A',
  size: 1,
  published_at: '2026-10-16T12:00:00Z',
  quality: 'q',
  languages: ['English'],
  custom_formats: [],
  score: 100,
  fits: 'this_slot',
  rejections: [],
  ...over,
})
const lang = { code: 'language' as const, message: 'm', overridable: true }

describe('release view', () => {
  it('words an age short and long', () => {
    const now = Date.parse('2026-11-01T12:00:00Z')
    expect(ageShort('2026-11-01T07:00:00Z', now)).toBe('5 h')
    expect(ageShort('2026-10-29T12:00:00Z', now)).toBe('3 d')
    expect(ageShort('2026-03-01T12:00:00Z', now)).toBe('8 mo')
    expect(ageShort('2024-10-01T12:00:00Z', now)).toBe('2 y')
    expect(ageLong('2026-10-29T12:00:00Z', now)).toBe('3 days')
  })

  it('signs points with a real minus', () => {
    expect([signed(1700), signed(-150)]).toEqual(['+1,700', '−150'])
  })

  it('groups the rejected Releases by their first rejection, the biggest first', () => {
    const items = [
      rel({ languages: ['German'], rejections: [lang] }),
      rel({ languages: ['German'], rejections: [lang] }),
      rel({ rejections: [{ code: 'blocklisted', message: 'm', overridable: false }] }),
      rel(),
    ]
    expect(rejectedSummary(items)).toEqual({ total: 3, groups: ['2 German only', '1 blocklisted'] })
  })

  it('writes the episodes a list of covers holds as runs per season', () => {
    const c = (episode: number) => ({ season: 5, episode, state: 'wanted' as const })
    expect(coverRange([c(1), c(2), c(3), c(4)])).toBe('S05E01 – E04')
    expect(coverRange([c(1), c(3)])).toBe('S05E01, E03')
  })

  it('says how much a replacing grab gains, and why the Best fit is the pick', () => {
    const covers = [
      { season: 5, episode: 1, state: 'filled' as const, file_score: 2100 },
      { season: 5, episode: 2, state: 'filled' as const, file_score: 2100 },
      { season: 5, episode: 5, state: 'wanted' as const },
    ]
    const pack = rel({ pack: true, season: 5, score: 2350, covers })
    expect(deltaText(pack, covers.slice(0, 2))).toBe('+250 each')
    expect(whyLine(pack, 1)).toBe('Season pack · covers all 1 Wanted · replaces 2 files')
  })
})

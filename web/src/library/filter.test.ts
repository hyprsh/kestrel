import { describe, expect, it } from 'vitest'
import { parseQuery } from '@hyprsh/design'
import { row } from '../test/library'
import { filterLibrary, libraryQualifiers, tabCounts, tabOf, withTab } from './filter'

const v = (profile: string, state: 'wanted' | 'filled' | 'downloading' | 'unmonitored' | 'unreleased', long_missing = false) => ({ version_id: 1, profile, state, long_missing })

const library = [
  row(1, 'Paddington', 'Ein Bär namens Paddington', { slots: { standard: v('hd-primary', 'filled'), '4k': v('4k-primary', 'wanted') } }),
  row(2, 'Heat', 'Heat', { slots: { standard: v('hd-primary', 'wanted', true), '4k': null } }),
  row(3, 'Zodiac', 'Zodiac', { slots: { standard: null, '4k': v('4k-primary', 'downloading') } }),
  row(4, 'Breaking Bad', 'Breaking Bad', { kind: 'series', slots: { standard: v('any-original', 'unreleased'), '4k': null } }),
]

const profiles = [
  { key: 'hd-primary', name: 'HD' },
  { key: '4k-primary', name: '4K HDR' },
  { key: 'any-original', name: 'Any (Original)' },
]

const kept = (input: string) => filterLibrary(library, parseQuery(input, libraryQualifiers(profiles)), profiles).map((r) => r.title)

describe('the Library filter', () => {
  it('keeps Titles with any Slot in a state; commas mean either, - leaves out', () => {
    expect(kept('is:wanted')).toEqual(['Paddington', 'Heat'])
    expect(kept('is:downloading,unreleased')).toEqual(['Zodiac', 'Breaking Bad'])
    expect(kept('-is:wanted')).toEqual(['Zodiac', 'Breaking Bad'])
    expect(kept('is:long_missing')).toEqual(['Heat'])
    expect(kept('is:filled is:wanted')).toEqual(['Paddington']) // repeated: both must match
  })

  it('keeps Titles with a Version in a Slot', () => {
    expect(kept('slot:4k')).toEqual(['Paddington', 'Zodiac'])
    expect(kept('-slot:4k')).toEqual(['Heat', 'Breaking Bad'])
    expect(kept('slot:standard,4k kind:movie')).toEqual(['Paddington', 'Heat', 'Zodiac'])
  })

  it('keeps Titles with a Version under a Profile, by its name in any case', () => {
    expect(kept('profile:hd')).toEqual(['Paddington', 'Heat'])
    expect(kept('profile:"Any (Original)",hd -slot:4k')).toEqual(['Heat', 'Breaking Bad'])
    expect(kept('profile:Unknown')).toEqual([])
  })

  it('sorts by Wanted since, the longest Wanted first and Titles that are not Wanted last, in their order', () => {
    const dated = [
      row(1, 'Filled', 'Filled', { wanted_since: null }),
      row(2, 'Recent', 'Recent', { wanted_since: '2026-10-10T00:00:00Z' }),
      row(3, 'Also Filled', 'Also Filled', { wanted_since: null }),
      row(4, 'Ancient', 'Ancient', { wanted_since: '2026-01-01T00:00:00Z' }),
    ]
    const sorted = (input: string) => filterLibrary(dated, parseQuery(input, libraryQualifiers([])), []).map((r) => r.title)
    expect(sorted('')).toEqual(['Filled', 'Recent', 'Also Filled', 'Ancient'])
    expect(sorted('sort:wanted_since')).toEqual(['Ancient', 'Recent', 'Filled', 'Also Filled'])
  })

  it('matches free text against both titles', () => {
    expect(kept('bär')).toEqual(['Paddington'])
    expect(kept('bad kind:series')).toEqual(['Breaking Bad'])
  })

  it('looks for the name before an episode code or a season, and for nothing at a bare code', () => {
    for (const q of ['breaking s5e7', 'breaking 5x07', 'breaking S05E07', 'breaking s5']) expect(kept(q)).toEqual(['Breaking Bad'])
    expect(kept('heat s2e5')).toEqual(['Heat'])
    expect(kept('s2e5')).toEqual([])
    expect(kept('2x05')).toEqual([])
    expect(kept('s2')).toEqual([])
    expect(kept('zodiac s2e5')).toEqual(['Zodiac'])
  })

  it('matches free text fuzzily, per word, keeping the Library order', () => {
    expect(kept('bar namens')).toEqual(['Paddington']) // no accent needed
    expect(kept('bad breaking')).toEqual(['Breaking Bad'])
    expect(kept('paddingtn')).toEqual(['Paddington'])
    expect(kept('a')).toEqual(['Paddington', 'Heat', 'Zodiac', 'Breaking Bad']) // not best match first
    expect(kept('bb')).toEqual([]) // no initials across a title
    expect(kept('paddingtn kind:series')).toEqual([]) // the qualifiers still filter
  })
})

describe('the state tabs', () => {
  const q = (text: string) => parseQuery(text, libraryQualifiers(profiles))
  const tab = (text: string, to: Parameters<typeof withTab>[1]) => withTab(text, to, libraryQualifiers(profiles))

  it('read the tab off the one is: term, and none off anything else', () => {
    expect(tabOf(q(''))).toBe('all')
    expect(tabOf(q('pad kind:movie is:long_missing'))).toBe('long_missing')
    expect(tabOf(q('is:filled'))).toBe('') // a state with no tab
    expect(tabOf(q('is:wanted,downloading'))).toBe('')
    expect(tabOf(q('-is:wanted'))).toBe('')
    expect(tabOf(q('is:wanted is:long_missing'))).toBe('')
  })

  it('write the one is: term, keeping the rest', () => {
    expect(tab('', 'wanted')).toBe('is:wanted')
    expect(tab('pad is:wanted kind:movie', 'downloading')).toBe('pad kind:movie is:downloading')
    expect(tab('is:wanted -is:filled slot:4k', 'all')).toBe('slot:4k')
  })

  it('count the Titles each would show under the other terms', () => {
    expect(tabCounts(library, q('kind:movie is:wanted'), profiles, new Set([2]))).toEqual({ all: 3, wanted: 2, long_missing: 1, downloading: 2, unreleased: 0, unmonitored: 0 })
  })
})

describe('the Library sort', () => {
  const dated = [
    row(1, 'beta', 'beta', { year: null, size: 5, added_at: '2026-10-03T00:00:00Z' }),
    row(2, 'Alpha', 'Alpha', { year: 2001, size: 9, added_at: '2026-10-02T00:00:00Z' }),
    row(3, 'Gamma 10', 'Gamma 10', { year: 1999, size: 1, added_at: '2026-10-01T00:00:00Z' }),
    row(4, 'Gamma 9', 'Gamma 9', { year: 2010, size: 0, added_at: '2026-09-30T00:00:00Z' }),
  ]
  const sorted = (input: string) => filterLibrary(dated, parseQuery(input, libraryQualifiers([])), []).map((r) => r.id)

  it('orders by name, year, size and added, each both ways; a Title without a year goes last either way', () => {
    expect(sorted('')).toEqual([1, 2, 3, 4])
    expect(sorted('sort:added-asc')).toEqual([4, 3, 2, 1])
    expect(sorted('sort:name-asc')).toEqual([2, 1, 4, 3]) // case-blind, numbers in order
    expect(sorted('sort:name-desc')).toEqual([3, 4, 1, 2])
    expect(sorted('sort:year-desc')).toEqual([4, 2, 3, 1])
    expect(sorted('sort:year-asc')).toEqual([3, 2, 4, 1])
    expect(sorted('sort:size-desc')).toEqual([2, 1, 3, 4])
    expect(sorted('sort:size-asc')).toEqual([4, 3, 1, 2])
  })
})

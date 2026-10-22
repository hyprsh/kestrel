import { describe, expect, it } from 'vitest'
import { parseQuery } from '@hyprsh/design'
import { row } from '../test/library'
import { filterLibrary, libraryQualifiers } from './filter'

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

  it('matches free text fuzzily, per word, keeping the Library order', () => {
    expect(kept('bar namens')).toEqual(['Paddington']) // no accent needed
    expect(kept('bad breaking')).toEqual(['Breaking Bad'])
    expect(kept('paddingtn')).toEqual(['Paddington'])
    expect(kept('a')).toEqual(['Paddington', 'Heat', 'Zodiac', 'Breaking Bad']) // not best match first
    expect(kept('bb')).toEqual([]) // no initials across a title
    expect(kept('paddingtn kind:series')).toEqual([]) // the qualifiers still filter
  })
})

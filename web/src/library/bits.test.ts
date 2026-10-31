import { describe, expect, it } from 'vitest'
import { coverageSegments, dotOf } from './bits'

describe('dotOf', () => {
  it.each([
    ['filled', false, { state: 'success' }],
    ['downloading', false, { state: 'info' }],
    ['wanted', false, { state: 'warning', variant: 'outline' }],
    ['wanted', true, { state: 'error', variant: 'outline' }],
    ['unreleased', false, { state: 'neutral', variant: 'dashed' }],
  ])('maps %s (long missing: %s)', (state, longMissing, dot) => {
    expect(dotOf(state, longMissing)).toEqual(dot)
  })

  it('marks a Slot with no Version as a faint dot, never a ring', () => {
    const dot = dotOf(null, false)
    expect(dot).toEqual({ state: 'neutral', faint: true })
    expect(dot.variant).toBeUndefined()
  })
})

describe('coverageSegments', () => {
  const base = { episodes: 0, filled: 0, wanted: 0, long_missing: 0, unmonitored: 0, downloading: 0, downloading_long_missing: 0, size: 0 }

  it('splits 21 filled, 2 downloading, 1 Wanted, 1 Long Missing and 15 not monitored into five segments in order', () => {
    // Wanted is 4: the 2 downloading, the 1 Wanted and the 1 Long Missing.
    const c = { ...base, episodes: 25, filled: 21, wanted: 4, long_missing: 1, downloading: 2, unmonitored: 15 }
    expect(coverageSegments(c)).toEqual([
      { value: 21, tone: 'success' },
      { value: 2, tone: 'info' },
      { value: 1, tone: 'warning' },
      { value: 1, tone: 'error' },
      { value: 15, tone: 'neutral' },
    ])
  })

  it('counts a downloading Long Missing episode once, as downloading', () => {
    // 6 Wanted: 3 downloading (1 of them Long Missing), 2 other Long Missing and 1 left. The segments add up to the 20 released.
    const c = { ...base, filled: 10, wanted: 6, long_missing: 3, downloading: 3, downloading_long_missing: 1, unmonitored: 4 }
    const segs = coverageSegments(c)
    expect(segs.map((s) => s.value)).toEqual([10, 3, 1, 2, 4])
    expect(segs.reduce((n, s) => n + s.value, 0)).toBe(10 + 6 + 4)
  })

  it('is one green segment for a fully filled Series, and none without coverage', () => {
    expect(coverageSegments({ ...base, episodes: 21, filled: 21 })[0]).toEqual({ value: 21, tone: 'success' })
    expect(
      coverageSegments({ ...base, episodes: 21, filled: 21 })
        .slice(1)
        .every((s) => s.value === 0),
    ).toBe(true)
    expect(coverageSegments(null)).toEqual([])
  })
})

// The run bars' numbers and the words that stand in for them.
import { describe, expect, it } from 'vitest'
import { BAR_MAX, BAR_MIN, barHeights, runsLabel, took, type JobRun } from './runs'

const run = (duration_ms: number, error: string | null = null): JobRun => ({ started_at: '2026-11-01T10:00:00Z', finished_at: '2026-11-01T10:00:01Z', duration_ms, error })

describe('took', () => {
  it('keeps the decimals of a short run, which span would round away', () => {
    expect([40, 200, 1400, 38_000, 125_000].map(took)).toEqual(['<0.1 s', '0.2 s', '1.4 s', '38 s', '2 min'])
  })
})

describe('barHeights', () => {
  it('scales each run to the longest, between the smallest and tallest bar', () => {
    expect(barHeights([run(0), run(5000), run(10_000)])).toEqual([BAR_MIN, Math.round((BAR_MIN + BAR_MAX) / 2), BAR_MAX])
  })

  it('does not stretch runs that all took a moment to the tallest bar', () => {
    expect(Math.max(...barHeights([run(200), run(200)]))).toBeLessThan(BAR_MAX / 2)
  })
})

describe('runsLabel', () => {
  it('says how many runs, how many failed and how long they took', () => {
    expect(runsLabel('Search', [run(200), run(1400, 'boom'), run(300)])).toBe('Search: last 3 runs, oldest first. 2 ok, 1 failed. Took 0.2 s to 1.4 s.')
    expect(runsLabel('Import', [run(4000)])).toBe('Import: last 1 run, oldest first. 1 ok. Took 4.0 s.')
  })

  it('says when there are none', () => {
    expect(runsLabel('Prune', [])).toBe('Prune: no runs yet')
  })
})

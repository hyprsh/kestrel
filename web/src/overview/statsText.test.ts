import { describe, expect, it } from 'vitest'
import { grabDays, stats } from '../test/statsData'
import { niceTicks } from './charts'
import { answerText, bytesText, speedText, fillDelta, fullInText, grabsAlternative, hitText, standOut } from './statsText'
import { growthLine } from './LibraryCards'
import { speedRange } from './ClientCard'

const GB = 1024 ** 3

describe('figures', () => {
  it('writes sizes in 1024-based GB and TB, one decimal under ten', () => {
    expect(bytesText(0)).toBe('0 B')
    expect(bytesText(440 * GB)).toBe('440 GB')
    expect(bytesText(1.2 * 1024 * GB)).toBe('1.2 TB')
    expect(bytesText(4 * 1024 * GB)).toBe('4 TB')
    expect(bytesText(24_000_000)).toBe('23 MB')
    expect(bytesText(5 * 1024 ** 2)).toBe('5 MB')
  })

  it('writes the time until the disks are full in months, then years, and nothing without an estimate', () => {
    expect(fullInText(null)).toBeNull()
    expect(fullInText(0.4)).toBe('full in under a month')
    expect(fullInText(1)).toBe('full in ~1 month')
    expect(fullInText(9.2)).toBe('full in ~9 months')
    expect(fullInText(30)).toBe('full in ~2.5 years')
  })

  it('compares the median time to fill with the range before', () => {
    expect(fillDelta(null, 100)).toBeNull()
    expect(fillDelta(100, null)).toBeNull()
    expect(fillDelta(2 * 3600 + 14 * 60, 2 * 3600 + 52 * 60)).toEqual({ text: '38 min faster', faster: true })
    expect(fillDelta(3600, 1800)).toEqual({ text: '30 min slower', faster: false })
    expect(fillDelta(3600, 3630)).toEqual({ text: 'about the same', faster: false })
  })

  it('writes speeds in decimal MB/s, kB/s under one', () => {
    expect(speedText(24_000_000)).toBe('24 MB/s')
    expect(speedText(2_500_000)).toBe('2.5 MB/s')
    expect(speedText(800_000)).toBe('800 kB/s')
  })

  it('shows a dash where an indexer was never answered', () => {
    expect(hitText(null)).toBe('—')
    expect(hitText(0.814)).toBe('81%')
    expect(answerText(null)).toBe('—')
    expect(answerText(600)).toBe('0.6 s')
    expect(answerText(2400)).toBe('2.4 s')
  })

  it('names the growth and the Series share, whichever can be said', () => {
    const base = stats().storage
    expect(growthLine(base)).toBe('Growing ~45 GB a week · Series take 82%')
    expect(growthLine({ ...base, growth_bytes_per_week: null })).toBe('Series take 82%')
    expect(growthLine({ ...base, growth_bytes_per_week: null, series_share: null })).toBeNull()
  })

  it('describes the speed range', () => {
    expect(speedRange([])).toBe('no downloads')
    expect(speedRange([12_000_000, 31_000_000])).toBe('between 12 MB/s and 31 MB/s')
    expect(speedRange([5_000_000])).toBe('at 5 MB/s')
    expect(speedRange([4_500_000])).toBe('at 4.5 MB/s')
  })

  it('puts clean numbers on a column chart axis', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(1)).toEqual([0, 1])
    expect(niceTicks(3)).toEqual([0, 5])
    expect(niceTicks(7)).toEqual([0, 5, 10])
    expect(niceTicks(23)).toEqual([0, 25, 50])
    expect(niceTicks(100)).toEqual([0, 50, 100])
  })
})

describe('what stands out', () => {
  it('names the busiest day and the indexer with the most failed Grabs', () => {
    const s = stats()
    const sentence = standOut(s)
    expect(sentence).toMatch(/^Busiest: .+, 8 Grabs\./)
    expect(sentence).toContain('Failures cluster on altHUB.')
  })

  it('leaves the busiest day out when there are fewer than 5 Grabs or no day with 3', () => {
    const few = stats({ grabs: { imported: 3, failed: 0, per_day: grabDays(30, [3]) } })
    expect(standOut({ ...few, indexers: [] })).toBeNull()
    const spread = stats({ grabs: { imported: 8, failed: 0, per_day: grabDays(30, [2, 2, 2, 2]) } })
    expect(standOut({ ...spread, indexers: [] })).toBeNull()
  })

  it('names no indexer unless one has two failures and more than any other', () => {
    const none = stats({ grabs: { imported: 0, failed: 0, per_day: grabDays(30) }, indexers: stats().indexers.map((i) => ({ ...i, failed: 1 })) })
    expect(standOut(none)).toBeNull()
    const tie = stats({ grabs: { imported: 0, failed: 0, per_day: grabDays(30) }, indexers: stats().indexers.map((i) => ({ ...i, failed: 3 })) })
    expect(standOut(tie)).toBeNull()
  })

  it('says a failure cluster alone when the days are thin', () => {
    const s = stats({ grabs: { imported: 1, failed: 0, per_day: grabDays(30, [1]) } })
    expect(standOut(s)).toBe('Failures cluster on altHUB.')
  })

  it('sums the chart up for a screen reader, with the busiest day', () => {
    const s = stats()
    expect(grabsAlternative(s)).toMatch(/^Grabs per day over the last 30 days: \d+ imported, 1 failed; busiest day .+ with 8 Grabs\.$/)
    const empty = stats({ grabs: { imported: 0, failed: 0, per_day: grabDays(7) }, range: '7d' })
    expect(grabsAlternative(empty)).toBe('Grabs per day over the last 7 days: 0 imported, 0 failed.')
  })
})

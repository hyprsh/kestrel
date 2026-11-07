import { describe, expect, it } from 'vitest'
import { seasonAir } from './seasonAir'
import { episode } from '../test/series'

const now = Date.parse('2026-11-07T12:00:00Z')
const aired = (id: number, air_date: string | null) => episode(id, 2, id, `E${id}`, { air_date })

describe('the air pill of a season', () => {
  it('names the next episode of a season that is airing', () => {
    expect(seasonAir([aired(1, '2026-10-29'), aired(2, '2026-11-12'), aired(3, '2026-11-19')], now, true)).toEqual({ text: 'Next Thu, Nov 12', tone: 'blue' })
    expect(seasonAir([aired(1, '2026-10-29'), aired(2, '2026-11-07')], now, false)).toEqual({ text: 'Next today', tone: 'blue' })
  })

  it('says when a season starts while nothing in it has aired, and nothing of a season with no air dates', () => {
    expect(seasonAir([aired(1, '2026-12-01'), aired(2, null)], now, true)).toEqual({ text: 'Starts Tue, Dec 1', tone: 'blue' })
    expect(seasonAir([aired(1, null), aired(2, null)], now, true)).toBeNull()
  })

  it('says the latest season is airing while it has episodes with no date yet', () => {
    expect(seasonAir([aired(1, '2026-10-29'), aired(2, null)], now, true)).toEqual({ text: 'Airing', tone: 'blue' })
    expect(seasonAir([aired(1, '2026-10-29'), aired(2, null)], now, false)).toBeNull()
  })

  it('says the latest season is finished once every episode has aired, and says nothing of an older one', () => {
    expect(seasonAir([aired(1, '2026-10-22'), aired(2, '2026-10-29')], now, true)).toEqual({ text: 'Finished', tone: 'gray' })
    expect(seasonAir([aired(1, '2008-01-20')], now, false)).toBeNull()
    expect(seasonAir([], now, true)).toBeNull()
  })
})

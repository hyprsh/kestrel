import { describe, expect, it } from 'vitest'
import type { LogEvent } from '../api/log'
import { byDay, dayLabel, foldRows } from './rows'

const ev = (id: number, at: string, routine: boolean): LogEvent => ({
  id,
  at,
  kind: routine ? 'search' : 'import',
  routine,
  title_id: null,
  version_id: null,
  episode_id: null,
  grab_id: null,
  request_id: null,
  message: 'x',
  trigger: null,
  reason: '',
  data: null,
})

// Local noon, so the day does not move with the time zone the tests run in.
const day = (d: number, h = 12, min = 0) => new Date(2026, 9, d, h, min).toISOString()

describe('folding routine events', () => {
  it('folds consecutive routine events into one row and leaves the others and a lone routine one alone', () => {
    const rows = foldRows([
      ev(9, day(17, 13), false),
      ev(8, day(17, 12, 50), true),
      ev(7, day(17, 12, 40), true),
      ev(6, day(17, 12, 30), true),
      ev(5, day(17, 12, 20), false),
      ev(4, day(17, 12, 10), true),
      ev(3, day(17, 12, 0), false),
    ])
    expect(rows.map((r) => (r.type === 'fold' ? `fold:${r.events.map((e) => e.id)}` : `event:${r.id}`))).toEqual(['event:9', 'fold:8,7,6', 'event:5', 'event:4', 'event:3'])
  })

  it('does not fold across a day', () => {
    const rows = foldRows([ev(4, day(17, 0, 10), true), ev(3, day(17, 0, 5), true), ev(2, day(16, 23, 55), true), ev(1, day(16, 23, 50), true)])
    expect(rows.map((r) => r.type)).toEqual(['fold', 'fold'])
  })
})

describe('days', () => {
  const now = new Date(2026, 9, 17, 15).getTime()
  it('names Today, Yesterday and then the date', () => {
    expect(dayLabel('2026-10-17', now)).toBe('Today')
    expect(dayLabel('2026-10-16', now)).toBe('Yesterday')
    expect(dayLabel('2026-10-12', now)).toMatch(/Oct 12/)
    expect(dayLabel('2025-10-12', now)).toMatch(/2025/)
  })

  it('splits the rows into their days in order', () => {
    const rows = foldRows([ev(3, day(17), false), ev(2, day(16), false), ev(1, day(16, 8), false)])
    expect(byDay(rows, now).map((d) => [d.label, d.rows.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 2],
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { grabEntry } from '../test/grabs'
import { entriesOf } from './stages'

const order = (...finished: ReturnType<typeof grabEntry>[]) => entriesOf([], [], finished, [], [], null).map((e) => e.key)

describe('the History order', () => {
  it('is newest first by the minute the row shows', () => {
    expect(
      order(
        grabEntry({ grab_id: 1, updated_at: '2026-03-01T10:00:00.000Z' }),
        grabEntry({ grab_id: 2, updated_at: '2026-03-01T10:05:00.000Z' }),
        grabEntry({ grab_id: 3, updated_at: '2026-03-01T10:02:00.000Z' }),
      ),
    ).toEqual(['g2', 'g3', 'g1'])
  })

  it('breaks a tie within the same minute by Grab id, whatever order the rows arrive in or the seconds say', () => {
    const a = grabEntry({ grab_id: 7, updated_at: '2026-03-01T10:00:05.000Z' })
    const b = grabEntry({ grab_id: 8, updated_at: '2026-03-01T10:00:50.000Z' })
    const c = grabEntry({ grab_id: 10, updated_at: '2026-03-01T10:00:20.000Z' })
    expect(order(b, c, a)).toEqual(['g7', 'g8', 'g10'])
    expect(order(a, b, c)).toEqual(['g7', 'g8', 'g10'])
  })
})

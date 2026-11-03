import { describe, expect, it } from 'vitest'
import { bytesText } from './format'
import { size } from './library/bits'

const GB = 1024 ** 3

describe('bytesText', () => {
  it('writes sizes in 1024-based units picked by magnitude, one decimal under ten', () => {
    expect(bytesText(0)).toBe('0 B')
    expect(bytesText(440 * GB)).toBe('440 GB')
    expect(bytesText(1.2 * 1024 * GB)).toBe('1.2 TB')
    expect(bytesText(4 * 1024 * GB)).toBe('4 TB')
    expect(bytesText(24_000_000)).toBe('23 MB')
    expect(bytesText(5 * 1024 ** 2)).toBe('5 MB')
  })

  it('reads 109787.3 GB as 107 TB, in the Library footer and the Overview alike', () => {
    const bytes = 109787.3 * GB
    expect(bytesText(bytes)).toBe('107 TB')
    expect(size(bytes)).toBe('107 TB')
  })
})

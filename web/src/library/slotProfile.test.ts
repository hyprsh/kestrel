import { describe, expect, it } from 'vitest'
import { profileName, slotProfile } from './slotProfile'

describe('slotProfile', () => {
  it('names the Slot and then the Profile', () => {
    expect(slotProfile('standard', 'HD')).toBe('Standard · HD')
  })
  it('leaves the Profile out when its name is the Slot label, ignoring case', () => {
    expect(slotProfile('4k', '4K')).toBe('4K')
    expect(slotProfile('4k', '4k')).toBe('4K')
    expect(slotProfile('standard', '4K')).toBe('Standard · 4K')
  })
})

describe('profileName', () => {
  it('falls back to the key while the names load or when the Profile is gone', () => {
    expect(profileName(new Map([['hd-primary', 'HD']]), 'hd-primary')).toBe('HD')
    expect(profileName(new Map(), 'hd-primary')).toBe('hd-primary')
  })
})

import { describe, expect, it } from 'vitest'
import { versionLabel } from './versionLabel'

describe('versionLabel', () => {
  it('adds the commit in brackets when the build has one', () => {
    expect(versionLabel('edge', '34e3846')).toBe('edge (34e3846)')
  })
  it('is the bare version when no commit is known', () => {
    expect(versionLabel('dev', '')).toBe('dev')
    expect(versionLabel('0.13.0', '')).toBe('0.13.0')
  })
})

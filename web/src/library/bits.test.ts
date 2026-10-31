import { describe, expect, it } from 'vitest'
import { dotOf } from './bits'

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

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { placeOf, placePath } from '../place'
import { dotState, SlotLegend } from './slotState'

describe('the Slot state language', () => {
  it('names the seven states in the legend, in order', () => {
    render(<SlotLegend />)
    const items = within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['Have', 'Downloading', 'Wanted', 'Long Missing', 'Not out yet', 'Upgrade wanted', 'Not monitored'])
    expect(items.map((i) => i.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['filled', 'downloading', 'wanted', 'long_missing', 'unreleased', 'upgrade', 'unmonitored'])
  })

  it('draws a Wanted Version that has been so for long as Long Missing', () => {
    expect(dotState('wanted', true)).toBe('long_missing')
    expect(dotState('wanted', false)).toBe('wanted')
    expect(dotState(null)).toBeNull()
  })
})

describe('the address of a Title at a Slot', () => {
  it('writes and reads ?slot=', () => {
    expect(placePath('library', '', '12', { season: null, episode: null, slot: '4k' })).toBe('/library/12?slot=4k')
    expect(placeOf('/library/12?slot=4k')).toMatchObject({ screen: 'library', section: '12', slot: '4k' })
    expect(placeOf('/library/12?slot=%3Cb%3E').slot).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { libraryQualifiers } from './filter'
import { slotNamesOf } from './slots'
import { slotRecord } from '../test/slots'

const four = [slotRecord('kids', 'Kids', 3), slotRecord('standard', 'Standard', 0), slotRecord('4k', '4K', 1), slotRecord('remux', 'Remux archive', 2)]

describe('slotNamesOf', () => {
  it('orders by position and names each Slot by its stored label', () => {
    const slots = slotNamesOf(four)
    expect(slots.list.map((r) => r.id)).toEqual(['standard', '4k', 'remux', 'kids'])
    expect(slots.order(['kids', 'nope', 'standard'])).toEqual(['standard', 'kids', 'nope'])
    expect(slots.name('remux')).toBe('Remux archive')
    expect(slots.name('german')).toBe('German')
  })

  it('gives every Slot a short label of its own', () => {
    const shorts = slotNamesOf([slotRecord('a', 'Remux 1080', 0), slotRecord('b', 'Remux 4K', 1)])
    expect(shorts.short('a')).not.toBe(shorts.short('b'))
    expect(slotNamesOf(four).short('4k')).toBe('4K')
  })

  it('keeps STD for the label Standard, shows a label of four characters or fewer in full, and shortens a longer one', () => {
    const shorts = slotNamesOf([slotRecord('a', 'Standard', 0), slotRecord('b', '4K', 1), slotRecord('c', 'Kids', 2), slotRecord('d', 'Remux', 3), slotRecord('e', 'Original', 4)])
    expect([...'abcde'].map((id) => shorts.short(id))).toEqual(['STD', '4K', 'KIDS', 'REM', 'ORI'])
  })

  it('keys STD on the label, not the id', () => {
    expect(slotNamesOf([slotRecord('standard', 'Everyday', 0)]).short('standard')).toBe('EVE')
    expect(slotNamesOf([slotRecord('movies', 'Standard', 0)]).short('movies')).toBe('STD')
  })

  it('has Slot chrome unless the library is known to have exactly one Slot', () => {
    expect(slotNamesOf([slotRecord('standard', 'Standard', 0)]).several).toBe(false)
    expect(slotNamesOf(four).several).toBe(true)
    expect(slotNamesOf().several).toBe(true)
  })
})

describe('the Library filter', () => {
  it('offers every Slot, in Slot order, whether or not any Title holds a Version there', () => {
    const slot = libraryQualifiers([], slotNamesOf(four)).find((f) => f.name === 'slot')!
    expect(slot.label).toBe('Slot')
    expect(slot.values).toEqual(['standard', '4k', 'remux', 'kids'])
    expect(slot.options?.remux).toEqual({ label: 'Remux archive' })
  })

  it('has no Slot menu in a library of one Slot', () => {
    const slot = libraryQualifiers([], slotNamesOf([slotRecord('standard', 'Standard', 0)])).find((f) => f.name === 'slot')!
    expect(slot.label).toBeUndefined()
  })
})

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readColumnWidths, useColumnWidths } from './columnWidths'

const key = 'kestrel.columns.t'

afterEach(() => vi.restoreAllMocks())

describe('column widths', () => {
  it('start as the defaults when nothing is stored', () => {
    const { result } = renderHook(() => useColumnWidths('t'))
    expect(result.current.widths).toEqual({})
    expect(result.current.isDefault).toBe(true)
  })

  it('read what was stored', () => {
    localStorage.setItem(key, JSON.stringify({ message: 480 }))
    const { result } = renderHook(() => useColumnWidths('t'))
    expect(result.current.widths).toEqual({ message: 480 })
    expect(result.current.isDefault).toBe(false)
  })

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[1,2]'],
    ['a number', '12'],
    ['null', 'null'],
  ])('fall back to the defaults for a corrupt value (%s)', (_, value) => {
    localStorage.setItem(key, value)
    expect(readColumnWidths('t')).toEqual({})
  })

  it('drop entries that are not a positive width', () => {
    localStorage.setItem(key, JSON.stringify({ a: 200, b: 'wide', c: -4, d: 0, e: null }))
    expect(readColumnWidths('t')).toEqual({ a: 200 })
  })

  it('survive a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useColumnWidths('t'))
    expect(result.current.widths).toEqual({})
    act(() => result.current.onChange({ message: 500 }, { phase: 'end' }))
    expect(result.current.widths).toEqual({ message: 500 })
  })

  it('are stored when a resize ends, not while it drags, and cleared by a reset', () => {
    const { result } = renderHook(() => useColumnWidths('t'))
    act(() => result.current.onChange({ message: 400 }, { phase: 'drag' }))
    expect(result.current.widths).toEqual({ message: 400 })
    expect(localStorage.getItem(key)).toBeNull()

    act(() => result.current.onChange({ message: 420 }, { phase: 'end' }))
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ message: 420 })

    act(() => result.current.reset())
    expect(result.current.widths).toEqual({})
    expect(localStorage.getItem(key)).toBeNull()
  })
})

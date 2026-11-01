import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveColumnOrder, useColumnOrder } from './columnOrder'

const key = 'kestrel.columns.t.order'
const defaults = ['aired', 'standard', '4k']

afterEach(() => vi.restoreAllMocks())

describe('column order', () => {
  it('starts as the default when nothing is stored', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    expect(result.current.order).toEqual(defaults)
    expect(result.current.isDefault).toBe(true)
  })

  it('moves a column, remembers it and reads it back', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    act(() => result.current.moveBy('4k', -1))
    expect(result.current.order).toEqual(['aired', '4k', 'standard'])
    expect(result.current.isDefault).toBe(false)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['aired', '4k', 'standard'])
    expect(renderHook(() => useColumnOrder('t', defaults)).result.current.order).toEqual(['aired', '4k', 'standard'])
  })

  it('does not move a column past either end', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    act(() => result.current.moveBy('aired', -1))
    act(() => result.current.moveBy('4k', 1))
    expect(result.current.isDefault).toBe(true)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('resets to the default and forgets the stored order', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    act(() => result.current.moveBy('aired', 1))
    act(() => result.current.reset())
    expect(result.current.order).toEqual(defaults)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it.each([
    ['not JSON', '{oops'],
    ['an object', '{"a":1}'],
    ['a number', '12'],
    ['null', 'null'],
    ['no known key', '["x","y"]'],
  ])('falls back to the default for a corrupt value (%s)', (_, value) => {
    localStorage.setItem(key, value)
    expect(renderHook(() => useColumnOrder('t', defaults)).result.current.order).toEqual(defaults)
  })

  it('drops unknown and repeated keys and appends a new column in its default place', () => {
    expect(resolveColumnOrder(['4k', 'gone', 4, '4k', 'aired'], defaults)).toEqual(['4k', 'aired', 'standard'])
    localStorage.setItem(key, JSON.stringify(['standard', 'aired']))
    expect(renderHook(() => useColumnOrder('t', defaults)).result.current.order).toEqual(['standard', 'aired', '4k'])
  })

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    expect(result.current.order).toEqual(defaults)
    act(() => result.current.moveBy('aired', 1))
    expect(result.current.order).toEqual(['standard', 'aired', '4k'])
  })

  it('moves a column dropped on another head, to the place of that head', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    const target = document.createElement('th')
    target.dataset.column = '4k'
    document.body.append(target)
    document.elementFromPoint = () => target
    const props = result.current.head('aired')
    act(() => props.onPointerDown({ button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 } as never))
    act(() => void fireEvent.pointerMove(window, { clientX: 40, clientY: 0 }))
    act(() => void fireEvent.pointerUp(window))
    expect(result.current.order).toEqual(['standard', '4k', 'aired'])
    target.remove()
  })

  it('ignores a press that does not travel, and a touch', () => {
    const { result } = renderHook(() => useColumnOrder('t', defaults))
    const props = result.current.head('aired')
    act(() => props.onPointerDown({ button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 } as never))
    act(() => void fireEvent.pointerUp(window))
    act(() => props.onPointerDown({ button: 0, pointerType: 'touch', clientX: 0, clientY: 0 } as never))
    act(() => void fireEvent.pointerMove(window, { clientX: 40, clientY: 0 }))
    act(() => void fireEvent.pointerUp(window))
    expect(result.current.isDefault).toBe(true)
  })
})

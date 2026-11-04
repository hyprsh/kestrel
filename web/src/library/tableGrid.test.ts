import { describe, expect, it } from 'vitest'
import { gridOf } from './tableGrid'

describe('gridOf', () => {
  it('gives a wide screen the name column, 104 px per Version and the menu column', () => {
    expect(gridOf(2, false).style.gridTemplateColumns).toBe('minmax(0,1fr) repeat(2, 104px) 56px')
  })
  it('leaves out the Version columns of a Title with none', () => {
    expect(gridOf(0, false).style.gridTemplateColumns).toBe('minmax(0,1fr) 56px')
    expect(gridOf(0, true).style.gridTemplateColumns).not.toContain('repeat(0')
  })
  it('gives a phone the name column, 40 px per Version and the menu column', () => {
    expect(gridOf(3, true).style.gridTemplateColumns).toBe('minmax(0,1fr) repeat(3, 40px) 36px')
  })
})

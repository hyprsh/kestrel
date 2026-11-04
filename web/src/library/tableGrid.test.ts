import { describe, expect, it } from 'vitest'
import { gridOf } from './tableGrid'

describe('gridOf', () => {
  it('gives a wide screen the name column, 104 px per Version and the actions column', () => {
    expect(gridOf(2, false).style.gridTemplateColumns).toBe('220px repeat(2, 104px) minmax(104px,1fr)')
  })
  it('gives a phone the name column, 40 px per Version and the menu column', () => {
    expect(gridOf(3, true).style.gridTemplateColumns).toBe('minmax(0,1fr) repeat(3, 40px) 36px')
  })
})

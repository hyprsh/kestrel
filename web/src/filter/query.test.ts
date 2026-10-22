import { parseQuery } from '@hyprsh/design'
import { describe, expect, it } from 'vitest'
import { kindQualifier } from './query'

describe('the kind: qualifier', () => {
  it('takes Movies or Series, and excludes only where the screen allows it', () => {
    expect(parseQuery('kind:series,movie', [kindQualifier()]).terms).toMatchObject([{ name: 'kind', values: ['series', 'movie'] }])
    expect(parseQuery('-kind:movie', [kindQualifier()]).problems).toHaveLength(1)
    expect(parseQuery('-kind:movie', [kindQualifier(true)]).terms).toMatchObject([{ name: 'kind', values: ['movie'], excluded: true }])
  })

  it('names a value it does not take', () => {
    const q = parseQuery('kind:show', [kindQualifier()])
    expect(q.terms).toEqual([])
    expect(q.problems[0].message).toMatch(/movie|series/)
  })
})

import { describe, expect, it } from 'vitest'
import { parse, suggest, valuesOf, withoutTerm, withoutValue, withValue, type Qualifier } from './query'

const qualifiers: Qualifier[] = [
  { name: 'kind', help: 'what happened', values: ['grab', 'grab_failed', 'import_rejected', 'health_raised'], negatable: true },
  { name: 'slot', help: 'the Slot', values: ['standard', '4k'] },
  { name: 'title', help: 'a Title by name' },
]

describe('parsing a filter', () => {
  it('reads qualifiers with comma-separated values, quoted values and the free text around them', () => {
    const q = parse('kind:grab_failed,import_rejected heat slot:4k title:"Breaking Bad"  wave', qualifiers)

    expect(q.terms).toMatchObject([
      { name: 'kind', values: ['grab_failed', 'import_rejected'], negated: false },
      { name: 'slot', values: ['4k'], negated: false },
      { name: 'title', values: ['Breaking Bad'], negated: false },
    ])
    expect(q.text).toBe('heat wave')
  })

  it('reads a leading - as exclusion, and leaves unknown qualifiers and unfinished ones out of the terms', () => {
    const q = parse('-kind:health_raised error:disk kind: Kind:grab', qualifiers)

    expect(q.terms).toMatchObject([
      { name: 'kind', values: ['health_raised'], negated: true },
      { name: 'kind', values: ['grab'], negated: false },
    ])
    expect(q.text).toBe('error:disk')
    expect(q.problems).toEqual([])
  })

  it('names the values a qualifier does not take and the qualifiers that cannot exclude, and drops them', () => {
    const q = parse('slot:xl,4k -slot:standard kind:nope title:anything', qualifiers)

    expect(q.terms).toMatchObject([
      { name: 'slot', values: ['4k'], negated: false },
      { name: 'title', values: ['anything'], negated: false },
    ])
    expect(q.problems).toEqual([
      { message: 'slot: takes standard or 4k, not “xl”', span: [0, 10] },
      { message: 'slot: cannot be excluded', span: [11, 25] },
      { message: 'kind: takes grab, grab_failed, import_rejected or health_raised, not “nope”', span: [26, 35] },
    ])
  })
})

describe('reading what a qualifier asks for', () => {
  it('ORs the values of one term and ANDs the same qualifier typed twice, leaving exclusions out', () => {
    const q = parse('kind:grab,grab_failed kind:grab_failed,import_rejected -kind:grab slot:4k', qualifiers)

    expect(valuesOf(q, 'kind')).toEqual(['grab_failed'])
    expect(valuesOf(q, 'slot')).toEqual(['4k'])
    expect(valuesOf(q, 'title')).toBeNull()
  })

  it('says nothing can match when the repeats share no value, and maps each term first when asked', () => {
    const q = parse('kind:grab kind:import_rejected', qualifiers)

    expect(valuesOf(q, 'kind')).toEqual([])
    expect(valuesOf(q, 'kind', (vs) => vs.flatMap((v) => (v === 'grab' ? ['grab', 'import_rejected'] : [v])))).toEqual(['import_rejected'])
  })
})

describe('suggesting values', () => {
  const titled = [...qualifiers.slice(0, 2), { name: 'title', help: 'a Title', suggestions: ['Breaking Bad', 'Better Call Saul', 'Paddington'] }]

  it('offers the values of the qualifier being typed, best match first, without the ones already chosen', () => {
    expect(suggest('heat kind:', 10, titled).map((s) => s.value)).toEqual(['grab', 'grab_failed', 'import_rejected', 'health_raised'])
    expect(suggest('kind:grab,', 10, titled).map((s) => s.value)).toEqual(['grab_failed', 'import_rejected', 'health_raised'])
    expect(suggest('kind:rab', 8, titled).map((s) => s.value)).toEqual(['grab', 'grab_failed'])
    expect(suggest('title:b', 7, titled).map((s) => s.value)).toEqual(['Breaking Bad', 'Better Call Saul'])
    expect(suggest('heat', 4, titled)).toEqual([])
    expect(suggest('kind:grab heat', 14, titled)).toEqual([])
  })

  it('completes the value under the caret, quoting it, and puts the caret after it', () => {
    const [first] = suggest('slot:4k title:"bre heat', 18, titled)
    expect(first).toEqual({ value: 'Breaking Bad', input: 'slot:4k title:"Breaking Bad" heat', caret: 28 })
    expect(suggest('-kind:grab,he', 13, titled)[0]).toMatchObject({ input: '-kind:grab,health_raised', caret: 24 })
  })
})

describe('editing a filter', () => {
  it('adds a value to the qualifier already there, as an OR, or as a new qualifier, quoting it when needed', () => {
    expect(withValue('heat', 'kind', 'grab', qualifiers)).toBe('heat kind:grab')
    expect(withValue('kind:grab heat', 'kind', 'grab_failed', qualifiers)).toBe('kind:grab,grab_failed heat')
    expect(withValue('kind:grab', 'kind', 'grab', qualifiers)).toBe('kind:grab')
    expect(withValue('-kind:grab', 'kind', 'grab_failed', qualifiers)).toBe('-kind:grab kind:grab_failed')
    expect(withValue('', 'title', 'Breaking Bad', qualifiers)).toBe('title:"Breaking Bad"')
    expect(withValue('title:"Breaking Bad"', 'title', 'Better Call Saul', qualifiers)).toBe('title:"Breaking Bad","Better Call Saul"')
  })

  it('removes one qualifier and leaves the rest as typed', () => {
    const input = 'kind:grab heat  slot:4k title:"Breaking Bad"'
    expect(withoutTerm(input, 1, qualifiers)).toBe('kind:grab heat title:"Breaking Bad"')
    expect(withoutTerm(input, 0, qualifiers)).toBe('heat  slot:4k title:"Breaking Bad"')
    expect(withoutTerm(input, 2, qualifiers)).toBe('kind:grab heat  slot:4k')
  })

  it('takes one value out of every qualifier of that name that has it, and the qualifier with its last value', () => {
    expect(withoutValue('kind:grab,grab_failed heat', 'kind', 'grab', qualifiers)).toBe('kind:grab_failed heat')
    expect(withoutValue('heat kind:grab slot:4k', 'kind', 'grab', qualifiers)).toBe('heat slot:4k')
    expect(withoutValue('kind:grab kind:grab,health_raised', 'kind', 'grab', qualifiers)).toBe('kind:health_raised')
    expect(withoutValue('-kind:grab heat', 'kind', 'grab', qualifiers)).toBe('-kind:grab heat')
    expect(withoutValue('heat', 'kind', 'grab', qualifiers)).toBe('heat')
  })
})

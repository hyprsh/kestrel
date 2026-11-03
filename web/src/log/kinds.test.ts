import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { slotNamesOf } from '../library/slots'
import { kindLabels, logQualifiers } from './filter'
import { kindNames } from './sentence'

// Every Kind constant of internal/history, read from the Go source so a new one without words fails here.
const goKinds = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../internal/history/history.go'), 'utf8')
const serverKinds = [...goKinds.matchAll(/^\s+\w+\s+Kind = "([a-z_]+)"/gm)].map((m) => m[1])

describe('the kinds the Log records', () => {
  it('finds the server kinds', () => {
    expect(serverKinds.length).toBeGreaterThanOrEqual(50)
  })

  it('has a name for the opened event and a Filter menu entry for every kind', () => {
    for (const kind of serverKinds) {
      expect(kindNames[kind], `kindNames has no ${kind}`).toBeTruthy()
      expect(kindLabels[kind], `the Filter menu has no ${kind}`).toBeTruthy()
    }
    expect(Object.keys(kindLabels).sort()).toEqual([...serverKinds].sort())
  })

  it('offers the same kinds to the menu and to kind: completion', () => {
    const kind = logQualifiers(kindLabels, [], slotNamesOf()).find((f) => f.name === 'kind')
    expect(Object.keys(kindLabels).every((k) => kind?.values?.includes(k))).toBe(true)
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { failureText, shortWhy, whyFailed } from './activity/words'
import { reasonWords, rejectionText, rejectionWords } from './rejection'

// Every rejection code of internal/imports (the Reason* constants), read from the Go source so a new one without words fails here.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../internal/imports')
const serverCodes = readdirSync(dir)
  .filter((file) => file.endsWith('.go') && !file.endsWith('_test.go'))
  .flatMap((file) => [...readFileSync(resolve(dir, file), 'utf8').matchAll(/^\s+Reason\w+\s+= "([a-z_]+)"/gm)].map((m) => m[1]))

describe('the words for an Import rejection', () => {
  it('finds the server codes', () => {
    expect(serverCodes).toEqual(expect.arrayContaining(['invalid', 'resolution', 'language', 'not_upgrade', 'incomplete_archive', 'unmonitored', 'unknown_episode']))
  })

  it('has words for every code of the server, and none for a code it does not give', () => {
    for (const code of serverCodes) expect(rejectionWords[code], `no words for ${code}`).toBeTruthy()
    expect(Object.keys(rejectionWords).sort()).toEqual([...serverCodes].sort())
  })

  it('says a code in words and leaves any other text as it came', () => {
    expect(rejectionText('not_upgrade')).toBe('not an upgrade')
    expect(rejectionText('from_a_newer_server')).toBe('from_a_newer_server')
    expect(rejectionText('constructor')).toBe('constructor')
    expect(reasonWords('import rejected: not_upgrade')).toBe('import rejected: not an upgrade')
    expect(reasonWords('not_upgrade')).toBe('not an upgrade')
    expect(reasonWords('Not good enough')).toBe('Not good enough')
  })

  it('shows a failed Grab whose Import rejected it in words in Activity', () => {
    expect(shortWhy({ failure: 'language' })).toBe('wrong language')
    expect(whyFailed({ failure: 'not_upgrade', blocklist_reason: 'import rejected: not_upgrade' })).toBe('not an upgrade (Blocklisted: import rejected: not an upgrade)')
    expect(shortWhy({ failure: 'encrypted' })).toBe(failureText.encrypted)
  })
})

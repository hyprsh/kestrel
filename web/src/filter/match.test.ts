import { describe, expect, it } from 'vitest'
import { matchText } from './match'

describe('matching free text', () => {
  it('matches when every word appears in one of the haystacks, ignoring case', () => {
    expect(matchText('', ['anything'])).toBe(true)
    expect(matchText('heat', ['Sent Heat.1995 to SABnzbd'])).toBe(true)
    expect(matchText('breaking SAB', ['Sent S01E01 to SABnzbd', 'Breaking Bad'])).toBe(true)
    expect(matchText('breaking nzbget', ['Sent S01E01 to SABnzbd', 'Breaking Bad'])).toBe(false)
  })
})

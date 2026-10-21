import { describe, expect, it } from 'vitest'
import { matchText, rank } from './fuzzy'

const names = (query: string, texts: string[]) => rank(query, texts, (t) => [t]).map((r) => r.item)

describe('ranking by a fuzzy match', () => {
  it('ignores case, accents and punctuation', () => {
    expect(names('amelie', ['Heat', 'Amélie'])).toEqual(['Amélie'])
    expect(names('spiderman', ['Spider-Man: Homecoming', 'Superman'])).toEqual(['Spider-Man: Homecoming'])
    expect(names('schindlers list', ['Schindler’s List'])).toEqual(['Schindler’s List'])
    expect(names('law and order', ['Law & Order'])).toEqual(['Law & Order'])
  })

  it('takes words in any order, initials and letters in order', () => {
    expect(names('bad breaking', ['Breaking Bad', 'Bad Boys'])).toEqual(['Breaking Bad'])
    expect(names('bb', ['Heat', 'Breaking Bad'])).toEqual(['Breaking Bad'])
    expect(names('brkbd', ['Breaking Bad'])).toEqual(['Breaking Bad'])
    expect(names('brary', ['Library', 'Logs'])).toEqual(['Library'])
    expect(names('zz', ['Breaking Bad'])).toEqual([])
  })

  it('forgives a typo or two in longer words, none in short ones', () => {
    expect(names('brekaing bda', ['Breaking Bad'])).toEqual([]) // "bda" is too short to forgive
    expect(names('brekaing', ['Breaking Bad'])).toEqual(['Breaking Bad']) // swapped letters
    expect(names('godfahter', ['The Godfather'])).toEqual(['The Godfather'])
    expect(names('paddingtn', ['Paddington 2'])).toEqual(['Paddington 2']) // a missing letter
    expect(names('intrestellr', ['Interstellar'])).toEqual(['Interstellar']) // two
    expect(names('hest', ['Heat'])).toEqual([])
    expect(names('pandora', ['Paddington'])).toEqual([])
  })

  it('ranks exact, then prefix, then word start, then letters in order, then typos', () => {
    const titles = ['The Duner', 'Dunkirk', 'Dune: Part Two', 'Dunkirk Extended', 'Dune', 'Dnue Messiah']
    expect(names('dune', titles)).toEqual(['Dune', 'Dune: Part Two', 'The Duner', 'Dunkirk Extended'])
    expect(names('dunes', titles)).toEqual(['Dune', 'The Duner', 'Dune: Part Two']) // one typo each, shortest first
  })

  it('keeps the order of equal matches and empty queries', () => {
    expect(names('', ['Heat', 'Alien'])).toEqual(['Heat', 'Alien'])
    expect(names('mo', ['Movies', 'Moana'])).toEqual(['Moana', 'Movies']) // the shorter first
    expect(names('mov', ['Movie A', 'Movie B'])).toEqual(['Movie A', 'Movie B'])
  })

  it('says which field matched and where, in the original text', () => {
    const [hit] = rank('bb', [{ title: 'Breaking Bad', alias: 'Kein Bier' }], (t) => [t.alias, t.title])
    expect(hit.field).toBe(1)
    expect(hit.match.ranges).toEqual([
      [0, 1],
      [9, 10],
    ])
    expect(rank('spiderman', ['Spider-Man'], (t) => [t])[0].match.ranges).toEqual([[0, 10]])
    expect(rank('amel', ['Amélie'], (t) => [t])[0].match.ranges).toEqual([[0, 4]])
    expect(rank('bad brea', ['Breaking Bad'], (t) => [t])[0].match.ranges).toEqual([
      [0, 4],
      [9, 12],
    ])
  })
})

describe('matching free text, per word', () => {
  it('matches when every word appears in one of the haystacks, ignoring case', () => {
    expect(matchText('', ['anything'])).toBe(true)
    expect(matchText('heat', ['Sent Heat.1995 to SABnzbd'])).toBe(true)
    expect(matchText('breaking SAB', ['Sent S01E01 to SABnzbd', 'Breaking Bad'])).toBe(true)
    expect(matchText('breaking nzbget', ['Sent S01E01 to SABnzbd', 'Breaking Bad'])).toBe(false)
  })

  it('ignores accents and punctuation, and forgives a typo in longer words', () => {
    expect(matchText('amelie', ['Amélie'])).toBe(true)
    expect(matchText('spiderman', ['Spider-Man: Homecoming'])).toBe(true)
    expect(matchText('homecoming spider', ['Spider-Man: Homecoming'])).toBe(true)
    expect(matchText('rejcted', ['Import rejected: no video file'])).toBe(true)
    expect(matchText('importd', ['Import rejected', 'Heat'])).toBe(true)
    expect(matchText('heta', ['Heat'])).toBe(false) // too short for a typo
  })

  it('does not match letters scattered across a line', () => {
    expect(matchText('grab', ['Sent Gravity Release to SABnzbd'])).toBe(false)
    expect(matchText('bb', ['Breaking Bad'])).toBe(false)
  })
})

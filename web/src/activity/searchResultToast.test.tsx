import { describe, expect, it } from 'vitest'
import { publishSearchFinished, takeFinished, type SearchFinished } from '../live/searchFinished'
import { searchResultText } from './searchResultToast'

const done = (over: Partial<SearchFinished>): SearchFinished => ({ search_id: 'a', version_id: 1, title_id: 1, title: 'Dune', upgrade: false, outcome: 'none', grabbed: [], ...over })

describe('what a finished search says', () => {
  it('says No better Release found for an Upgrade, and that nothing was found to grab otherwise', () => {
    expect(searchResultText(done({ upgrade: true }), 'Dune in Standard')).toBe('No better Release found for Dune in Standard')
    expect(searchResultText(done({}), 'Dune in Standard')).toBe('No Release found to grab for Dune in Standard')
  })

  it('names one Release grabbed, and lists several', () => {
    expect(searchResultText(done({ outcome: 'grabbed', grabbed: ['A'] }), 'S01E01 in 4K')).toBe('Grabbed A for S01E01 in 4K')
    expect(searchResultText(done({ outcome: 'grabbed', grabbed: ['A', 'B'] }), 'Season 1 in 4K')).toBe('Grabbed 2 Releases for Season 1 in 4K: A, B')
  })

  it('gives the reason a search failed', () => {
    expect(searchResultText(done({ outcome: 'failed', error: 'No indexer is enabled' }), 'Dune')).toBe('Search for Dune failed: No indexer is enabled')
  })
})

describe('a frame that comes before its search is watched', () => {
  it('waits to be taken, once', () => {
    publishSearchFinished(done({ search_id: 'early' }))
    expect(takeFinished('early')?.search_id).toBe('early')
    expect(takeFinished('early')).toBeUndefined()
  })
})

// What a Wanted Version or episode says of its last search, short: "23 releases, all German only" (foundText) and "Last searched 2 h ago ·
// 14 releases · none fit the Profile" (lastSearchLine). The facts are the Version's `last_search`.
import type { components } from '../api/schema.gen'
import { plural } from '../format'
import { ago } from '../time'

type LastSearch = components['schemas']['LastSearch']
type RejectionCount = components['schemas']['RejectionCount']

const codeWords: Record<string, string> = {
  below_min_score: 'below the cutoff',
  resolution: 'the wrong resolution',
  quality: 'a quality the Profile does not take',
  language: 'in the wrong language',
  original_language_unknown: 'with an unknown original language',
  blocklisted: 'blocklisted',
  other_slot: 'for another Slot',
  episode_not_listed: 'naming an unlisted episode',
  season_not_listed: 'naming an unlisted season',
  original_only: 'in the original language only',
  size: 'outside the size limit',
  year_outside_run: "naming a year outside the Series' run",
  alias_only: 'matching only an alias of the Series',
  episode_title_mismatch: "with an episode title the Series' episode does not have",
}

/** What a rejection group is, without its count: "German only", "below the cutoff". */
function reasonWords(r: RejectionCount): string {
  if (r.code === 'language' && r.detail) return `${r.detail} only`
  return codeWords[r.code] ?? r.code.replaceAll('_', ' ')
}

/**
 * What a Wanted Version's last search came to, short: "23 releases, all German only", "nothing found yet", "4 releases, none
 * fit the Profile". `all <reason>` when one rejection covers every release.
 */
export function foundText(ls: LastSearch): string {
  switch (ls.outcome) {
    case 'no_indexer':
      return 'no indexer is turned on'
    case 'error':
      return 'the search failed'
  }
  if (ls.releases === 0) return 'nothing found yet'
  const top = ls.reasons[0]
  if (top && top.count >= ls.releases) return `${plural(ls.releases, 'release')}, all ${reasonWords(top)}`
  return `${plural(ls.releases, 'release')}, ${ls.upgrade ? 'none better' : 'none fit the Profile'}`
}

/** How a search ended, as the last words of a line: "grabbed one", "none fit the Profile", "nothing found". */
function outcomeText(ls: LastSearch): string {
  switch (ls.outcome) {
    case 'grabbed':
      return 'grabbed one'
    case 'no_indexer':
      return 'no indexer is turned on'
    case 'error':
      return 'the search failed'
  }
  return ls.releases === 0 ? 'nothing found' : ls.upgrade ? 'none better' : 'none fit the Profile'
}

/** "Last searched 2 h ago · 14 releases · none fit the Profile": an episode's last search, for its cell's tooltip and popover. */
export function lastSearchLine(ls: LastSearch, now: number): string {
  const found = ls.outcome === 'no_indexer' || ls.outcome === 'error' ? [] : [plural(ls.releases, 'release')]
  return [`Last searched ${ago(ls.at, now)}`, ...found, outcomeText(ls)].join(' · ')
}

/**
 * The gray line under a Wanted Version's state on its card: "Last search 2 h ago · 20 releases, none fit the Profile", or that it was
 * not searched yet. Null for a Version that is not Wanted.
 */
export function lastSearchText(v: { state: string; last_search?: LastSearch | null }, now: number): string | null {
  if (v.state !== 'wanted') return null
  return v.last_search ? `Last search ${ago(v.last_search.at, now)} \u00b7 ${foundText(v.last_search)}` : 'Not searched yet'
}

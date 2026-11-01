// What Manual search shows of a Release, worked out from the API's Release: the segments, the rejected summary, the
// best fit, what a Release covers and replaces, the sort. No React in here.
import type { Release } from '../api/grabs'
import { sizeRange } from '../profiles/ladder'
import { manualSearchSortLabels, size } from './bits'

export type Cover = NonNullable<Release['covers']>[number]

/** The signed points of a Custom Format or a difference: "+1,700", "−150" (a real minus sign). */
export const signed = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US')}`

export const score = (n: number) => n.toLocaleString('en-US')

/** The key a Release is known by across searches: its id changes with every search, its name and indexer do not. */
export const keyOf = (r: Release) => `${r.indexer}\u0000${r.name}`

/** A Release fits when the Profile takes it: nothing rejects it. */
export const fitsProfile = (r: Release) => r.rejections.length === 0

/** Whether "Grab anyway" can never override a rejection of the Release (blocklisted, another Slot, a season TheTVDB does not list). */
export const rejectionBlocked = (r: Release) => r.fits === 'other_slot' || r.rejections.some((x) => !x.overridable)

/** What Grab does for a Release: refused when a rejection cannot be overridden, an override for the rest that are rejected. */
export function grabState(r: Release): { disabled: boolean; override: boolean; reason?: string } {
  const reason = r.rejections.map((x) => x.message).join(' · ') || undefined
  if (rejectionBlocked(r)) return { disabled: true, override: false, reason }
  return { disabled: false, override: r.rejections.length > 0, reason }
}

// ---- age -----------------------------------------------------------------------------------------------------

const DAY = 86_400_000

/** "5 h", "3 d", "8 mo", "2 y": the short age of a row. */
export function ageShort(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso))
  const hours = ms / 3_600_000
  if (hours < 48) return `${Math.floor(hours)} h`
  const days = ms / DAY
  if (days < 60) return `${Math.floor(days)} d`
  if (days < 365) return `${Math.floor(days / 30)} mo`
  return `${Math.floor(days / 365)} y`
}

/** "3 days", "5 hours", "8 months", "2 years": the age of the Best fit card. */
export function ageLong(iso: string, now = Date.now()): string {
  const [n, unit] = ageShort(iso, now).split(' ')
  const words: Record<string, [string, string]> = { h: ['hour', 'hours'], d: ['day', 'days'], mo: ['month', 'months'], y: ['year', 'years'] }
  return `${n} ${words[unit][Number(n) === 1 ? 0 : 1]}`
}

/** "Oct 29, 2026". */
export const published = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ---- what a Release holds ------------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, '0')

/** "E05", "E05 – E08" for a run, "E05, E07" otherwise. */
function episodeLabel(episodes: number[]): string {
  const sorted = episodes.slice().sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `E${two(sorted[0])}`
  const run = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)
  return run ? `E${two(sorted[0])} – E${two(sorted[sorted.length - 1])}` : sorted.map((n) => `E${two(n)}`).join(', ')
}

/** What a Series Release names: "Season pack", "E05", "E05 – E08"; null for a Movie. */
export function scopeText(r: Release): string | null {
  if (r.pack) return 'Season pack'
  const eps = r.episodes ?? []
  return eps.length > 0 ? episodeLabel(eps) : null
}

/** The title of each episode a Release names: an empty one (an episode without a title) shows as TBA. */
export const episodeNames = (r: Release): string[] => (r.episode_titles ?? []).map((t) => t || 'TBA')

/** The episodes of a list of covers as "S05E05", "S05E01 – E04, E06" (one season) or one such run per season. */
export function coverRange(covers: Cover[]): string {
  const bySeason = new Map<number, number[]>()
  for (const c of covers) {
    if (c.season == null || c.episode == null) continue
    bySeason.set(c.season, [...(bySeason.get(c.season) ?? []), c.episode])
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, eps]) => `S${two(season)}${episodeLabel(eps)}`)
    .join(', ')
}

const coversOf = (r: Release, state: Cover['state']) => (r.covers ?? []).filter((c) => c.state === state)

/** What grabbing the Release fills (Wanted covers) and replaces (covers the Version holds a file for). */
export function fillsReplaces(r: Release): { fills: Cover[]; replaces: Cover[] } {
  return { fills: coversOf(r, 'wanted'), replaces: coversOf(r, 'filled') }
}

/** "+250 each" when every replaced file gains the same, "+250 to +400" otherwise, "" when no file's Score is known. */
export function deltaText(r: Release, replaces: Cover[]): string {
  const deltas = replaces.filter((c) => c.file_score != null).map((c) => r.score - (c.file_score as number))
  if (deltas.length === 0) return ''
  const lo = Math.min(...deltas)
  const hi = Math.max(...deltas)
  if (lo === 0 && hi === 0) return 'same Score'
  if (lo === hi) return `${signed(lo)}${replaces.length > 1 ? ' each' : ''}`
  return `${signed(lo)} to ${signed(hi)}`
}

/** The Scores of the files a grab replaces: "2,100", or "2,100 – 2,300"; "" when none is known. */
export function heldScores(replaces: Cover[]): string {
  const scores = replaces.map((c) => c.file_score).filter((s): s is number => s != null)
  if (scores.length === 0) return ''
  const lo = Math.min(...scores)
  const hi = Math.max(...scores)
  return lo === hi ? score(lo) : `${score(lo)} – ${score(hi)}`
}

/** The Covers row of an opened Release: one line per kind of cover. */
export function coverLines(r: Release): string[] {
  const covers = r.covers ?? []
  if (covers.length === 0) return []
  if (covers.length === 1 && covers[0].season == null) {
    const c = covers[0]
    return [c.state === 'wanted' ? 'The Movie · Wanted' : c.state === 'filled' ? `The Movie · replaces the file${c.file_score != null ? ` (Score ${score(c.file_score)})` : ''}` : 'The Movie']
  }
  const { fills, replaces } = fillsReplaces(r)
  const other = coversOf(r, 'other')
  const lines: string[] = []
  if (fills.length > 0) lines.push(`${coverRange(fills)} · Wanted`)
  if (replaces.length > 0) lines.push(`${coverRange(replaces)} · ${replaces.length === 1 ? 'replaces a file' : 'replaces files'}${heldScores(replaces) ? ` (Score ${heldScores(replaces)})` : ''}`)
  if (other.length > 0) lines.push(`${coverRange(other)} · not Wanted`)
  return lines
}

/** One line on why the Best fit is the pick: "Season pack · covers all 6 Wanted". */
export function whyLine(r: Release, wanted: number): string {
  const { fills, replaces } = fillsReplaces(r)
  const parts: string[] = []
  const scope = scopeText(r)
  if (scope) parts.push(scope)
  if (fills.length > 0 && wanted > 0) parts.push(fills.length >= wanted ? `covers all ${wanted} Wanted` : `covers ${fills.length} of ${wanted} Wanted`)
  else if (fills.length > 0) parts.push(`covers ${fills.length} Wanted`)
  if (replaces.length > 0) parts.push(scope ? `replaces ${replaces.length} ${replaces.length === 1 ? 'file' : 'files'}` : 'replaces the file')
  if (parts.length === 0) parts.push('The highest Score that fits')
  return parts.join(' · ')
}

/** Each matched Custom Format with its points, and what is left of the Score once they are added up (the Profile's own points). */
export function breakdown(r: Release): { rows: { name: string; points: number }[]; rest: number } {
  const rows = r.custom_formats.map((f) => ({ name: f.name, points: f.points }))
  return { rows, rest: r.score - rows.reduce((sum, f) => sum + f.points, 0) }
}

// ---- segments ------------------------------------------------------------------------------------------------

export type Segment = 'fits' | 'packs' | 'episodes' | 'rejected'

export function inSegment(r: Release, segment: Segment): boolean {
  switch (segment) {
    case 'fits':
      return fitsProfile(r)
    case 'packs':
      return fitsProfile(r) && r.pack === true
    case 'episodes':
      return fitsProfile(r) && r.pack !== true
    case 'rejected':
      return !fitsProfile(r)
  }
}

export function segmentCounts(items: Release[]): Record<Segment, number> {
  const n = (s: Segment) => items.filter((r) => inSegment(r, s)).length
  return { fits: n('fits'), packs: n('packs'), episodes: n('episodes'), rejected: n('rejected') }
}

/** A Series search has season packs and episodes; a Movie only fits and rejected. */
export const isSeriesSearch = (items: Release[]) => items.some((r) => r.season != null)

/** The Release that fits with the highest Score, the newest of equals. */
export function bestFit(items: Release[]): Release | undefined {
  return items.filter(fitsProfile).sort((a, b) => b.score - a.score || Date.parse(b.published_at) - Date.parse(a.published_at))[0]
}

const codeLabels: Record<string, string> = {
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
}

/** How the rejected Releases group by their first rejection: "23 German only", "6 below the cutoff"; the biggest group first. */
export function rejectedSummary(items: Release[]): { total: number; groups: string[] } {
  const rejected = items.filter((r) => !fitsProfile(r))
  const by = new Map<string, Release[]>()
  // A size rejection is "over" or "under" the limit, which the server says in its message: those are two groups.
  const groupOf = (r: Release) => (r.rejections[0].code === 'size' ? `size:${r.rejections[0].message}` : r.rejections[0].code)
  for (const r of rejected) by.set(groupOf(r), [...(by.get(groupOf(r)) ?? []), r])
  const groups = [...by.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([code, rs]) => {
      if (code.startsWith('size:')) return `${rs.length} ${code.slice(5).toLowerCase()}`
      const langs = new Set(rs.map((r) => r.languages.join(', ')))
      if (code === 'language' && langs.size === 1 && rs[0].languages.length === 1) return `${rs.length} ${rs[0].languages[0]} only`
      return `${rs.length} ${codeLabels[code] ?? code.replaceAll('_', ' ')}`
    })
  return { total: rejected.length, groups }
}

/** "1 – 10 GB per episode": the size limit the Profile puts on the Release; null when it sets none. */
function sizeLimitText(r: Release): string | null {
  const range = sizeRange(r.size_limit)
  return range && `${range} per ${r.size_limit?.per_episode ? 'episode' : 'Movie'}`
}

/** What the Size row of an opened Release says: its size, and that it is within the Profile's limit when there is one. */
export function sizeLine(r: Release): string {
  const limit = sizeLimitText(r)
  return limit && !r.rejections.some((x) => x.code === 'size') ? `${size(r.size)} · within ${limit}` : size(r.size)
}

/** What a rejected Release's opened row says grabbing it means. */
export function rejectionAdvice(r: Release): string {
  if (rejectionBlocked(r)) return 'Kestrel never grabs this one.'
  if (r.rejections.some((x) => x.code === 'size')) {
    const limit = sizeLimitText(r)
    return `Its size is ${size(r.size)}${limit ? `, and the Profile takes ${limit}` : ''}. You can still grab it; Kestrel imports it like any other.`
  }
  if (r.rejections.some((x) => x.code === 'language' || x.code === 'resolution')) {
    return 'You can still grab it. Kestrel will import it, but it does not fit the Profile, so the Version stays Wanted and any fitting Release replaces it.'
  }
  return 'You can still grab it; Kestrel grabs it despite the rejection.'
}

// ---- sort ----------------------------------------------------------------------------------------------------

export type SortKey = 'score' | 'release' | 'quality' | 'languages' | 'formats' | 'size' | 'age' | 'indexer'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const BEST_FIRST: Sort = { key: 'score', dir: 'desc' }

/** The sortable things, in order; `text` ones sort alphabetically, the rest numerically. */
const sortKeys: { key: SortKey; text?: boolean }[] = [
  { key: 'score' },
  { key: 'release', text: true },
  { key: 'quality', text: true },
  { key: 'languages', text: true },
  { key: 'formats' },
  { key: 'size' },
  { key: 'age' },
  { key: 'indexer', text: true },
]

const points = (r: Release) => r.custom_formats.reduce((sum, f) => sum + f.points, 0)

function valueOf(r: Release, key: SortKey): string | number {
  switch (key) {
    case 'score':
      return r.score
    case 'release':
      return r.name
    case 'quality':
      return r.quality
    case 'languages':
      return r.languages.join(', ')
    case 'formats':
      return points(r)
    case 'size':
      return r.size
    case 'age':
      return Date.now() - new Date(r.published_at).getTime()
    case 'indexer':
      return r.indexer
  }
}

/** The order of the list: Releases that fit first, rejected ones below, each group sorted on its own. Ties keep best-first order. */
export function arrange(items: Release[], sort: Sort): Release[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const text = sortKeys.find((c) => c.key === sort.key)?.text
  const cmp = (a: Release, b: Release) => {
    const rejected = Number(a.rejections.length > 0) - Number(b.rejections.length > 0)
    if (rejected !== 0) return rejected
    const x = valueOf(a, sort.key)
    const y = valueOf(b, sort.key)
    const by = text ? String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true }) : Number(x) - Number(y)
    return by !== 0 ? sign * by : b.score - a.score
  }
  return items.slice().sort(cmp)
}

/** The sort Settings > Display names: `best_first`, or a column and a direction such as `size_desc`. */
export function defaultSort(value: string): Sort {
  const [key, dir] = value.split('_')
  return sortKeys.some((c) => c.key === key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : BEST_FIRST
}

// The sort is remembered for the browser session, across manual searches.
const VIEW_KEY = 'kestrel.manualSearchView'

/** The sort this browser session picked, or null when it has not: then the household's default sort stands. */
export function loadSort(): Sort | null {
  try {
    const s = (JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as { sort?: Sort } | null)?.sort
    if (s && sortKeys.some((c) => c.key === s.key) && (s.dir === 'asc' || s.dir === 'desc')) return { key: s.key, dir: s.dir }
  } catch {
    // no session storage: nothing is remembered
  }
  return null
}

export function saveSort(sort: Sort) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ sort }))
  } catch {
    // no session storage: nothing is remembered
  }
}

/** The sort menu: best first, then each column both ways. */
export const sortOptions = [
  { value: `${BEST_FIRST.key}:${BEST_FIRST.dir}`, label: manualSearchSortLabels.score.desc },
  ...sortKeys.flatMap((c) =>
    (['asc', 'desc'] as const).filter((dir) => !(c.key === BEST_FIRST.key && dir === BEST_FIRST.dir)).map((dir) => ({ value: `${c.key}:${dir}`, label: manualSearchSortLabels[c.key][dir] })),
  ),
]

export const sortLabel = (sort: Sort) => manualSearchSortLabels[sort.key][sort.dir]

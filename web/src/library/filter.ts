// The Library's qualifiers (kind:, is:, slot:, profile:, sort:) and what a parsed filter keeps
// of GET /titles. The grammar is the design's (parseQuery); all of it runs in the SPA. The state
// tabs above the list are `is:` written for you: a tab sets the one `is:` term, All takes it out.
import type { TitleRow } from '../api/queries'
import { matchText } from '../fuzzy'
import { parseQuery, withoutTerm, withValue, type Query, type Term } from '@hyprsh/design'
import { kindQualifier, type Facet } from '../filter/qualifiers'
import { slotKeys, slotLabel } from './bits'
import { parseCode, splitCode } from './episodeCode'

type Version = NonNullable<TitleRow['slots']['standard']>

/** A Profile as the filter needs it: Versions name it by key, people by name. */
type Profile = { key: string; name: string }

const states = ['wanted', 'filled', 'downloading', 'unmonitored', 'unreleased'] as const

/** A Profile as the menu offers it: its name, and a line saying what it takes. */
type ProfileChoice = { name: string; description?: string }

/** How the list can be ordered, each way round. A bare key (`sort:name`) runs its `first` way. */
const sortKeys = {
  added: { first: 'desc', asc: 'Oldest added', desc: 'Newest added' },
  name: { first: 'asc', asc: 'Name A–Z', desc: 'Name Z–A' },
  year: { first: 'desc', asc: 'Oldest year', desc: 'Newest year' },
  size: { first: 'desc', asc: 'Smallest', desc: 'Largest' },
  wanted_since: { first: 'asc', asc: 'Wanted longest', desc: 'Wanted shortest' },
} as const

type SortKey = keyof typeof sortKeys
export type Sort = { key: SortKey; dir: 'asc' | 'desc' }

/** The `sort:` values the menu offers; no term is Added, newest first. Wanted longest keeps its old value, `wanted_since`, so bookmarks still work. */
const sortValues = ['added-asc', 'name-asc', 'name-desc', 'year-desc', 'year-asc', 'size-desc', 'size-asc', 'wanted_since', 'wanted_since-desc'] as const

/** A `sort:` value as a key and a direction; no value is the default, Added, newest first. */
function sortOf(value: string | undefined): Sort {
  const [key, dir] = (value ?? '').split('-')
  if (!(key in sortKeys)) return { key: 'added', dir: 'desc' }
  const k = key as SortKey
  return { key: k, dir: dir === 'asc' || dir === 'desc' ? dir : sortKeys[k].first }
}

/** The words for an order, as the Sort menu and the phone's count line say it. */
export const sortLabel = (s: Sort) => sortKeys[s.key][s.dir]

/** The order a parsed filter asks for. */
export const sortOfQuery = (q: Query): Sort => sortOf(q.terms.find((t) => t.name === 'sort')?.values[0])

/** The Library's qualifiers, given the Profiles to offer. `is:` has no menu: the state tabs set it. */
export function libraryQualifiers(profiles: readonly ProfileChoice[]): Facet[] {
  return [
    { ...kindQualifier(true), label: 'Kind', options: { movie: { label: 'Movies' }, series: { label: 'Series' } } },
    {
      name: 'is',
      help: 'Titles with a Version in that state, or Long Missing',
      values: [...states, 'long_missing'],
      excludable: true,
      options: {
        wanted: { label: 'Wanted', description: 'No file, or one that no longer fits its Profile' },
        filled: { label: 'Filled', description: 'Has a file' },
        downloading: { label: 'Downloading', description: 'A Grab is on its way' },
        unmonitored: { label: 'Unmonitored', description: 'Not searched for' },
        unreleased: { label: 'Unreleased', description: 'Not out yet' },
        long_missing: { label: 'Long Missing', description: 'Wanted for more than 90 days' },
      },
    },
    {
      name: 'slot',
      label: 'Slot',
      help: 'Titles with a Version in that Slot',
      values: slotKeys,
      excludable: true,
      options: Object.fromEntries(slotKeys.map((k) => [k, { label: slotLabel[k] }])),
    },
    {
      name: 'profile',
      label: 'Profile',
      help: 'Titles with a Version under that Profile, by name; quote names with spaces',
      suggestions: profiles.map((p) => p.name),
      excludable: true,
      options: Object.fromEntries(profiles.map((p) => [p.name, { description: p.description }])),
    },
    {
      name: 'sort',
      label: 'Sort',
      single: sortLabel(sortOf(undefined)),
      help: 'Order the list: added, name, year, size or wanted_since (the longest Wanted first), with -asc or -desc to turn it round',
      values: sortValues,
      options: Object.fromEntries(sortValues.map((v) => [v, { label: sortLabel(sortOf(v)) }])),
    },
  ]
}

/** The state tabs above the list, in order: each is an `is:` value, All is none. */
export const stateTabs = [
  { value: 'all', label: 'All' },
  { value: 'wanted', label: 'Wanted' },
  { value: 'long_missing', label: 'Long Missing' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'unreleased', label: 'Unreleased' },
  { value: 'unmonitored', label: 'Unmonitored' },
] as const

export type StateTab = (typeof stateTabs)[number]['value']

/** The tab a query is on: All without an `is:` term, a tab for one `is:` term of its value, none ('') for anything else. */
export function tabOf(q: Query): StateTab | '' {
  const is = q.terms.filter((t) => t.name === 'is')
  if (is.length === 0) return 'all'
  const [t] = is
  if (is.length > 1 || t.excluded || t.values.length !== 1) return ''
  return stateTabs.find((s) => s.value === t.values[0])?.value ?? ''
}

/** The query on another tab: every `is:` term goes, and a tab other than All adds its own. Other terms and text stay. */
export function withTab(text: string, tab: StateTab, qualifiers: readonly Facet[]): string {
  let out = text
  for (;;) {
    const i = parseQuery(out, qualifiers).terms.reduce((last, t, j) => (t.name === 'is' ? j : last), -1)
    if (i < 0) break
    out = withoutTerm(out, i, qualifiers)
  }
  return tab === 'all' ? out : withValue(out, 'is', tab, qualifiers)
}

const versions = (r: TitleRow) => [r.slots.standard, r.slots['4k']].filter((s): s is Version => s !== null)

/** Whether a Title has one value of a qualifier. A `profile:` value is a name or a key, in any case. `grabbing` holds the Titles with a Grab on its way. */
function has(r: TitleRow, name: string, v: string, profiles: readonly Profile[], grabbing: ReadonlySet<number>): boolean {
  switch (name) {
    case 'kind':
      return r.kind === v
    case 'is':
      if (v === 'downloading' && grabbing.has(r.id)) return true
      return versions(r).some((s) => (v === 'long_missing' ? s.long_missing : s.state === v))
    case 'slot':
      return r.slots[v as keyof TitleRow['slots']] !== null
    case 'profile': {
      const lower = v.toLowerCase()
      const keys = profiles.filter((p) => p.name.toLowerCase() === lower).map((p) => p.key)
      return versions(r).some((s) => s.profile.toLowerCase() === lower || keys.includes(s.profile))
    }
  }
  return true
}

/** Whether a Title matches one term: any of its values, or none of them when excluded. */
function test(r: TitleRow, t: Term, profiles: readonly Profile[], grabbing: ReadonlySet<number>): boolean {
  const any = t.values.some((v) => has(r, t.name, v, profiles, grabbing))
  return t.excluded ? !any : any
}

/** Titles without the value (no year, not Wanted) go last whichever way the list runs. */
function nullsLast<T>(a: T | null, b: T | null, cmp: (a: T, b: T) => number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return cmp(a, b)
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function comparer({ key, dir }: Sort): (a: TitleRow, b: TitleRow) => number {
  const sign = dir === 'asc' ? 1 : -1
  switch (key) {
    case 'name':
      return (a, b) => sign * collator.compare(a.title, b.title)
    case 'year':
      return (a, b) => nullsLast(a.year, b.year, (x, y) => sign * (x - y))
    case 'size':
      return (a, b) => sign * (a.size - b.size)
    case 'wanted_since':
      return (a, b) => nullsLast(a.wanted_since, b.wanted_since, (x, y) => sign * x.localeCompare(y))
    case 'added':
      return (a, b) => sign * a.added_at.localeCompare(b.added_at)
  }
}

/**
 * The name part of the filter's free text: "harbour s2e5" looks for "harbour" (the code, which finds an episode or season,
 * is not part of a Title's name). A bare code names no Series, so it matches nothing (null), and the list does not fill
 * with every Series' S01E01.
 */
function nameOf(text: string): string | null {
  if (parseCode(text)) return null
  return splitCode(text)?.name ?? text
}

/**
 * The Titles a parsed filter keeps, in the order it asks for: every term must match, and `sort:` orders rather than filters.
 * `grabbing` holds the Titles with a Grab on its way, which `is:downloading` keeps. Ties keep the Library's order, newest first.
 */
export function filterLibrary(rows: readonly TitleRow[], q: Query, profiles: readonly Profile[], grabbing: ReadonlySet<number> = new Set()): TitleRow[] {
  const filters = q.terms.filter((t) => t.name !== 'sort')
  const text = nameOf(q.text)
  if (text === null) return []
  const kept = rows.filter((r) => filters.every((t) => test(r, t, profiles, grabbing)) && matchText(text, [r.title, r.primary_title]))
  const sort = sortOfQuery(q)
  // The Library comes newest first: the default order needs no sort, and keeps a Title added in the same second where it was.
  return sort.key === 'added' && sort.dir === 'desc' ? kept : kept.sort(comparer(sort))
}

/**
 * How many Titles each state tab would show: the filter's other terms and its text apply, its `is:` terms do not,
 * so a count says what a click on its tab leaves.
 */
export function tabCounts(rows: readonly TitleRow[], q: Query, profiles: readonly Profile[], grabbing: ReadonlySet<number>): Record<StateTab, number> {
  const base = filterLibrary(rows, { ...q, terms: q.terms.filter((t) => t.name !== 'is' && t.name !== 'sort') }, profiles, grabbing)
  const out = { all: base.length } as Record<StateTab, number>
  for (const { value } of stateTabs) if (value !== 'all') out[value] = base.filter((r) => has(r, 'is', value, profiles, grabbing)).length
  return out
}

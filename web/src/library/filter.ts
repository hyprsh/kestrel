// The Library's qualifiers (kind:, is:, slot:, profile:, sort:) and what a parsed filter keeps
// of GET /titles. The grammar is the design's (parseQuery); all of it runs in the SPA.
import type { TitleRow } from '../api/queries'
import { matchText } from '../fuzzy'
import type { Query, Term } from '@hyprsh/design'
import { kindQualifier, type Facet } from '../filter/qualifiers'
import { slotKeys, slotLabel } from './bits'

type Version = NonNullable<TitleRow['slots']['standard']>

/** A Profile as the filter needs it: Versions name it by key, people by name. */
type Profile = { key: string; name: string }

const states = ['wanted', 'filled', 'downloading', 'unmonitored', 'unreleased'] as const

/** A Profile as the menu offers it: its name, and a line saying what it takes. */
type ProfileChoice = { name: string; description?: string }

/** The Library's qualifiers, given the Profiles to offer. */
export function libraryQualifiers(profiles: readonly ProfileChoice[]): Facet[] {
  return [
    kindQualifier(true),
    {
      name: 'is',
      label: 'State',
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
      single: 'Default',
      help: 'Order the list: wanted_since puts the longest Wanted first',
      values: ['wanted_since'],
      options: { wanted_since: { label: 'Wanted longest', description: 'The longest Wanted first' } },
    },
  ]
}

const versions = (r: TitleRow) => [r.slots.standard, r.slots['4k']].filter((s): s is Version => s !== null)

/** Whether a Title has one value of a qualifier. A `profile:` value is a name or a key, in any case. */
function has(r: TitleRow, name: string, v: string, profiles: readonly Profile[]): boolean {
  switch (name) {
    case 'kind':
      return r.kind === v
    case 'is':
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
function test(r: TitleRow, t: Term, profiles: readonly Profile[]): boolean {
  const any = t.values.some((v) => has(r, t.name, v, profiles))
  return t.excluded ? !any : any
}

/** Wanted longest first; Titles that are not Wanted keep their order, last. */
function byWantedSince(a: TitleRow, b: TitleRow): number {
  if (a.wanted_since === null || b.wanted_since === null) return a.wanted_since === b.wanted_since ? 0 : a.wanted_since === null ? 1 : -1
  return a.wanted_since.localeCompare(b.wanted_since)
}

/** The Titles a parsed filter keeps, in the order it asks for: every term must match, and `sort:` orders rather than filters. */
export function filterLibrary(rows: readonly TitleRow[], q: Query, profiles: readonly Profile[]): TitleRow[] {
  const filters = q.terms.filter((t) => t.name !== 'sort')
  const kept = rows.filter((r) => filters.every((t) => test(r, t, profiles)) && matchText(q.text, [r.title, r.primary_title]))
  return q.terms.some((t) => t.name === 'sort') ? kept.sort(byWantedSince) : kept
}

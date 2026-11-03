// The Log's qualifiers (kind:, slot:, title:, by:, routine:) and how a parsed filter becomes the
// structured GET /events parameters. The grammar is the design's (parseQuery).
import type { LogFilter } from '../api/log'
import type { TitleRow } from '../api/queries'
import { parseQuery, termText, valuesOf, type Query } from '@hyprsh/design'
import { slotQualifier, type Facet } from '../filter/qualifiers'
import type { SlotNames } from '../library/slots'
import { triggerKinds } from './trigger'

/** Named sets of kinds, one per View: `kind:errors` is every kind that means something went wrong. They are typed or reached by a View, never listed in the Filter menu. */
const groups: Record<string, readonly string[]> = {
  grabs: ['grab', 'grab_failed', 'grab_canceled', 'grab_downloading', 'grab_completed'],
  imports: ['import', 'import_episode', 'import_rejected', 'import_stalled'],
  adoption: ['adoption', 'adoption_scanned'],
  errors: ['grab_failed', 'import_rejected', 'blocklist'],
  warnings: ['import_stalled', 'health_raised', 'original_offered'],
}

/** Old links: `kind:failures` was a group of its own and now means Errors plus Warnings. */
const aliases: Record<string, readonly string[]> = { failures: ['errors', 'warnings'] }

/** The groups the field takes: the Views' own, and the old `failures`. */
const groupNames = [...Object.keys(groups), ...Object.keys(aliases)]

/** How a group shows as a chip when it is in the field. */
const groupText: Record<string, { label: string }> = {
  grabs: { label: 'Grabs' },
  imports: { label: 'Imports' },
  adoption: { label: 'Adoption' },
  errors: { label: 'Errors' },
  warnings: { label: 'Warnings' },
}

/**
 * The Log's qualifiers, given the kinds it knows (with their labels) and the Library's Title names. The Filter menu only
 * refines what the Views do not cover: the single kinds, the Slot and routine events. Groups are typed (`kind:errors`) but not
 * offered, and Titles are suggested while typing `title:` but have no menu section.
 */
export function logQualifiers(kinds: Readonly<Record<string, string>>, titles: readonly string[], slots: SlotNames): Facet[] {
  return [
    {
      name: 'kind',
      label: 'Kind',
      help: 'What happened, or a group: grabs, imports, adoption, errors, warnings',
      values: [...Object.keys(kinds), ...groupNames],
      unlisted: groupNames,
      excludable: true,
      options: { ...Object.fromEntries(Object.entries(kinds).map(([k, label]) => [k, { label }])), ...groupText },
    },
    slotQualifier(slots, { label: 'Slot', help: 'Events about a Version in that Slot', excludable: true }),
    { name: 'title', help: 'Events about a Title, by name; quote names with spaces', suggestions: titles, excludable: true },
    {
      name: 'by',
      label: 'Started by',
      help: 'Who or what started it: person, api_key, sweep, rss, import, retry, request, rule, startup, job',
      values: Object.keys(triggerKinds),
      excludable: true,
      options: Object.fromEntries(Object.entries(triggerKinds).map(([k, label]) => [k, { label }])),
    },
    {
      name: 'sort',
      label: 'Sort',
      single: 'Newest first',
      help: 'Order the Log: oldest turns it round',
      values: ['oldest'],
      options: { oldest: { label: 'Oldest first' } },
    },
    {
      name: 'routine',
      label: 'Routine',
      help: 'Routine events, such as a download starting, are shown folded; routine:no leaves them out',
      values: ['yes', 'no'],
      unlisted: ['yes'],
      excludable: true,
      options: { no: { label: 'Hide routine events' } },
    },
  ]
}

/** The Titles a `title:` value names: those with exactly that name, or else those containing it. */
function titlesNamed(value: string, titles: readonly TitleRow[]): number[] {
  const v = value.toLowerCase()
  const names = (t: TitleRow) => [t.title.toLowerCase(), t.primary_title.toLowerCase()]
  const exact = titles.filter((t) => names(t).includes(v))
  return (exact.length > 0 ? exact : titles.filter((t) => names(t).some((n) => n.includes(v)))).map((t) => t.id)
}

/**
 * The GET /events filter for a parsed Log filter. Values of one qualifier are OR-ed; the same
 * qualifier typed twice must match both, so an empty list means nothing can match.
 */
export function logFilter(q: Query, titles: readonly TitleRow[]): LogFilter {
  const negated = (name: string) => q.terms.filter((t) => t.name === name && t.excluded).flatMap((t) => t.values)
  const expand = (values: string[]) => [...new Set(values.flatMap((v) => (aliases[v] ?? [v]).flatMap((a) => groups[a] ?? [a])))]
  const named = (values: string[]) => [...new Set(values.flatMap((v) => titlesNamed(v, titles)))]
  // The last routine: term decides, and -routine:yes means routine:no.
  const routine = q.terms.filter((t) => t.name === 'routine').at(-1)
  return {
    kinds: valuesOf(q, 'kind', expand),
    excludeKinds: expand(negated('kind')),
    slots: valuesOf(q, 'slot'),
    excludeSlots: [...new Set(negated('slot'))],
    titleIds: valuesOf(q, 'title', named),
    excludeTitleIds: named(negated('title')),
    // Routine events are in the Log unless routine:no leaves them out; they show folded.
    triggers: valuesOf(q, 'by'),
    excludeTriggers: [...new Set(negated('by'))],
    routine: routine ? (routine.values.at(-1) === 'yes') !== routine.excluded : true,
  }
}

/** Whether a parsed filter asks for the oldest events first (`sort:oldest`). */
export const oldestFirst = (q: Query) => q.terms.some((t) => t.name === 'sort' && t.values[0] === 'oldest')

/** A view of the Log: a name, an icon key and the filter it stands for. `terms` are the qualifier terms it sets, as typed. */
export type LogView = { key: string; label: string; terms: string; kinds: readonly string[] | null }

export const logViews: readonly LogView[] = [
  { key: 'everything', label: 'Everything', terms: '', kinds: null },
  { key: 'errors', label: 'Errors', terms: 'kind:errors', kinds: groups.errors },
  { key: 'warnings', label: 'Warnings', terms: 'kind:warnings', kinds: groups.warnings },
  { key: 'grabs', label: 'Grabs', terms: 'kind:grabs', kinds: groups.grabs },
  { key: 'imports', label: 'Imports', terms: 'kind:imports', kinds: groups.imports },
  { key: 'adoption', label: 'Adoption', terms: 'kind:adoption', kinds: groups.adoption },
  { key: 'searches', label: 'Searches', terms: 'kind:search', kinds: ['search'] },
]

/** The Log's `query` for a view: its terms, keeping the sort of `query`. */
export function viewQuery(view: LogView, query: string, qualifiers: readonly Facet[]): string {
  const sort = parseQuery(query, qualifiers).terms.find((t) => t.name === 'sort')
  return [view.terms, sort ? termText(sort) : ''].filter(Boolean).join(' ')
}

/** The values of the included `name:` terms of a parsed filter. */
const included = (parsed: Query, name: string) => parsed.terms.filter((t) => t.name === name && !t.excluded).flatMap((t) => t.values)

/**
 * The view a filter is on. Everything is a filter with no terms and no free text, apart from the sort. Any other view is
 * current while its own term is in the filter (`kind:errors`), however it is
 * refined further; with two views' terms present, or none, no view is current. A filter that is only a single kind, or a Slot,
 * is none of them.
 */
export function currentView(query: string, qualifiers: readonly Facet[]): LogView | undefined {
  const parsed = parseQuery(query, qualifiers)
  if (parsed.terms.every((t) => t.name === 'sort') && parsed.text.trim() === '') return logViews[0]
  const found = logViews.slice(1).filter((v) => {
    const own = parseQuery(v.terms, qualifiers).terms
    return own.every((t) => t.values.every((x) => included(parsed, t.name).includes(x)))
  })
  return found.length === 1 ? found[0] : undefined
}

/** How many refinements a filter adds to the view it is on: the facets of the Filter menu with a term, less what the view itself sets. */
export function refinements(query: string, qualifiers: readonly Facet[]): number {
  const parsed = parseQuery(query, qualifiers)
  const view = currentView(query, qualifiers)
  const own = view ? parseQuery(view.terms, qualifiers).terms : []
  const ownValues = (name: string) => own.filter((t) => t.name === name).flatMap((t) => t.values)
  const names = new Set<string>()
  for (const t of parsed.terms) {
    if (t.name !== 'kind' && t.name !== 'slot' && t.name !== 'routine' && t.name !== 'by') continue
    if (t.excluded || !ownValues(t.name).length || t.values.some((v) => !ownValues(t.name).includes(v))) names.add(t.name)
  }
  return names.size
}

/** How many events a view shows, from the summary's per-kind counts; Everything is every kind, routine ones (shown folded) included. */
export function viewCount(view: LogView, counts: readonly { kind: string; count: number }[]): number {
  return counts.filter((c) => !view.kinds || view.kinds.includes(c.kind)).reduce((n, c) => n + c.count, 0)
}

// The Log's qualifiers (kind:, slot:, title:, routine:) and how a parsed filter becomes the
// structured GET /events parameters. The grammar itself lives in filter/query.ts.
import type { LogFilter } from '../api/log'
import type { TitleRow } from '../api/queries'
import type { Qualifier, Query } from '../filter/query'
import { slotKeys, type SlotKey } from '../library/bits'

/** Named sets of kinds: `kind:failures` is every kind that means something went wrong. */
const groups: Record<string, readonly string[]> = {
  grabs: ['grab', 'grab_failed', 'grab_canceled', 'grab_downloading', 'grab_completed'],
  imports: ['import', 'import_episode', 'import_rejected', 'import_stalled'],
  adoption: ['adoption', 'adoption_scanned'],
  failures: ['grab_failed', 'import_rejected', 'import_stalled', 'blocklist', 'health_raised'],
}

const yesNo = ['yes', 'no']

/** The Log's qualifiers, given the kinds it knows and the Library's Title names. */
export function logQualifiers(kinds: readonly string[], titles: readonly string[]): Qualifier[] {
  return [
    {
      name: 'kind',
      help: 'What happened, or a group: grabs, imports, adoption, failures',
      values: [...new Set([...Object.keys(groups), ...kinds])],
      negatable: true,
    },
    { name: 'slot', help: 'Events about a Version in that Slot', values: slotKeys },
    { name: 'title', help: 'Events about a Title, by name; quote names with spaces', suggestions: titles },
    { name: 'routine', help: 'Show routine events, such as a download starting', values: yesNo },
  ]
}

const intersect = <T,>(sets: T[][]): T[] | null => (sets.length === 0 ? null : sets.reduce((a, b) => a.filter((x) => b.includes(x))))

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
  const positive = (name: string) => q.terms.filter((t) => t.name === name && !t.negated)
  const expand = (values: string[]) => [...new Set(values.flatMap((v) => groups[v] ?? [v]))]
  const routine = positive('routine').at(-1)?.values.at(-1)
  return {
    kinds: intersect(positive('kind').map((t) => expand(t.values))),
    excludeKinds: expand(q.terms.filter((t) => t.name === 'kind' && t.negated).flatMap((t) => t.values)),
    slots: intersect(positive('slot').map((t) => t.values as SlotKey[])),
    titleIds: intersect(positive('title').map((t) => [...new Set(t.values.flatMap((v) => titlesNamed(v, titles)))])),
    routine: routine === 'yes',
  }
}

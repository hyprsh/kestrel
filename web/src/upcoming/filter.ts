// Upcoming's qualifiers (kind:, is:, slot:) and how a query narrows the entries. The grammar is the design's (parseQuery).
// Values of one qualifier are alternatives; an excluded value (`-is:imported`) drops what it names.
import { parseQuery } from '@hyprsh/design'
import type { UpcomingItem, UpcomingSlot } from '../api/upcoming'
import { matchText } from '../fuzzy'
import { kindQualifier, slotQualifier, type Facet } from '../filter/qualifiers'
import type { SlotNames } from '../library/slots'

const states = ['wanted', 'imported'] as const

export const upcomingQualifiers = (slots: SlotNames): Facet[] => [
  { ...kindQualifier(true), label: 'Kind', options: { movie: { label: 'Movies' }, series: { label: 'Series' } } },
  {
    name: 'is',
    label: 'Status',
    help: 'Wanted: a Version still to find. Imported: every Version is in the Library',
    values: [...states],
    options: { wanted: { label: 'Wanted' }, imported: { label: 'Imported' } },
    excludable: true,
  },
  slotQualifier(slots, { help: 'Entries with a Version in that Slot', excludable: true }),
]

type Entry = { kind: UpcomingItem['kind']; title: string; episode_name?: string | null; slots: UpcomingSlot[] }

/** Whether an entry has the state `is:` names. An entry with nothing to do in a Slot counts as Imported only when every Slot is. */
const has = (e: Entry, state: string) =>
  state === 'wanted' ? e.slots.some((s) => s.state === 'wanted') : state === 'imported' ? e.slots.length > 0 && e.slots.every((s) => s.state === 'imported') : false

/** A function that says whether an entry passes the query: free text on the Title and the episode's name, and the tokens. */
export function upcomingFilter(text: string, slots: SlotNames): (e: Entry) => boolean {
  const q = parseQuery(text, upcomingQualifiers(slots))
  const terms = (name: string, excluded: boolean) => q.terms.filter((t) => t.name === name && t.excluded === excluded)
  const test: Record<string, (e: Entry, v: string) => boolean> = {
    kind: (e, v) => e.kind === v,
    is: has,
    slot: (e, v) => e.slots.some((s) => s.slot === v),
  }
  return (e) => {
    for (const name of Object.keys(test)) {
      // A term's values are alternatives, and the same qualifier typed twice must match both.
      if (!terms(name, false).every((t) => t.values.some((v) => test[name](e, v)))) return false
      if (terms(name, true).some((t) => t.values.some((v) => test[name](e, v)))) return false
    }
    return matchText(q.text, [e.title, e.episode_name ?? ''])
  }
}

// Activity's qualifiers (stage:, kind:, slot:, grab:, day:, from:, to:, indexer:) and how a parsed filter narrows the pipeline.
// The grammar is the design's (parseQuery); the Stage menu edits the `stage:` qualifier, so a
// path such as "/activity?q=stage:done" opens the screen on one stage.
import { valuesOf, type Query } from '@hyprsh/design'
import { matchText } from '../fuzzy'
import { kindQualifier, slotQualifier, type Facet } from '../filter/qualifiers'
import type { SlotNames } from '../library/slots'
import { facetsOf, stageLabel, stages, type Entry, type Stage } from './stages'

const dayHelp = 'A UTC day, like 2026-10-18'

/** `indexers` names the indexers by id for the chips; any id is accepted as typed, such as one of an indexer since removed. */
export const activityQualifiers = (slots: SlotNames, indexers: Readonly<Record<string, string>> = {}): Facet[] => [
  {
    // No label, so no menu section: the Views are the stages, and a phone's Filter menu opens with them.
    name: 'stage',
    help: `Where in the pipeline: ${stages.join(', ')}`,
    values: stages,
    options: Object.fromEntries(stages.map((s) => [s, { label: stageLabel[s] }])),
  },
  { ...kindQualifier(), label: 'Kind', options: { movie: { label: 'Movies' }, series: { label: 'Series' } } },
  slotQualifier(slots, { label: 'Slot', help: 'Grabs for a Version in that Slot' }),
  { name: 'grab', help: 'One Grab, by its id, in whatever stage it is in' },
  // The Overview's drill-downs: the Grabs that finished on a day or in a range, or came from an indexer. They look at
  // finished Grabs only, so a filter on them leaves out what is still in progress.
  { name: 'day', help: `Grabs that finished on a day. ${dayHelp}` },
  { name: 'from', help: `Grabs that finished on or after a day. ${dayHelp}` },
  { name: 'to', help: `Grabs that finished on or before a day. ${dayHelp}` },
  {
    name: 'indexer',
    help: 'Grabs from an indexer, by its id',
    options: Object.fromEntries(Object.entries(indexers).map(([id, name]) => [id, { label: name }])),
  },
]

type ActivityFilter = {
  /** The stages to show; null shows every stage. */
  stages: readonly Stage[] | null
  /** Whether anything but the stage narrows the rows. */
  narrowed: boolean
  /** Whether a row passes everything but the stage. */
  matches: (e: Entry) => boolean
}

/** Values of one qualifier are OR-ed; the same qualifier typed twice must match both. */
export function activityFilter(q: Query): ActivityFilter {
  const kinds = valuesOf(q, 'kind')
  const slots = valuesOf(q, 'slot')
  const grabs = valuesOf(q, 'grab')
  // The server filters the finished Grabs by these; no other row has a finishing day or an indexer id to match.
  const finished = valuesOf(q, 'day') !== null || valuesOf(q, 'from') !== null || valuesOf(q, 'to') !== null || valuesOf(q, 'indexer') !== null
  return {
    stages: valuesOf(q, 'stage') as Stage[] | null,
    narrowed: kinds !== null || slots !== null || grabs !== null || finished || q.text.trim() !== '',
    matches: (e) => {
      if (finished) return false
      const f = facetsOf(e)
      return (
        (!kinds || (f.kind !== null && kinds.includes(f.kind))) &&
        (!slots || (f.slot !== null && slots.includes(f.slot))) &&
        (!grabs || (f.grab !== null && grabs.includes(String(f.grab)))) &&
        matchText(q.text, f.text)
      )
    },
  }
}

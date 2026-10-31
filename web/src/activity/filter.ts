// Activity's qualifiers (stage:, kind:, slot:, grab:) and how a parsed filter narrows the pipeline.
// The grammar is the design's (parseQuery); the Stage menu edits the `stage:` qualifier, so a
// path such as "/activity?q=stage:done" opens the screen on one stage.
import { valuesOf, type Query } from '@hyprsh/design'
import { matchText } from '../fuzzy'
import { kindQualifier, type Facet } from '../filter/qualifiers'
import { slotKeys } from '../library/bits'
import { facetsOf, stageLabel, stages, type Entry, type Stage } from './stages'

export const activityQualifiers: Facet[] = [
  {
    name: 'stage',
    label: 'Stage',
    help: `Where in the pipeline: ${stages.join(', ')}`,
    values: stages,
    options: Object.fromEntries(stages.map((s) => [s, { label: stageLabel[s] }])),
  },
  kindQualifier(),
  { name: 'slot', help: 'Grabs for a Version in that Slot', values: slotKeys },
  { name: 'grab', help: 'One Grab, by its id, in whatever stage it is in' },
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
  return {
    stages: valuesOf(q, 'stage') as Stage[] | null,
    narrowed: kinds !== null || slots !== null || grabs !== null || q.text.trim() !== '',
    matches: (e) => {
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

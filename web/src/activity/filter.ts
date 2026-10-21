// Activity's qualifiers (stage:, kind:, slot:) and how a parsed filter narrows the pipeline.
// The grammar lives in filter/query.ts; the stage chips edit the same `stage:` qualifier, so a
// path such as "/activity?q=stage:done" opens the screen on one stage.
import { matchText } from '../fuzzy'
import { kindQualifier, parse, valuesOf, withoutValue, withValue, type Qualifier, type Query } from '../filter/query'
import { slotKeys } from '../library/bits'
import { facetsOf, stages, type Entry, type Stage } from './stages'

export const activityQualifiers: Qualifier[] = [
  { name: 'stage', help: `Where in the pipeline: ${stages.join(', ')}`, values: stages },
  kindQualifier(),
  { name: 'slot', help: 'Grabs for a Version in that Slot', values: slotKeys },
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
  return {
    stages: valuesOf(q, 'stage') as Stage[] | null,
    narrowed: kinds !== null || slots !== null || q.text.trim() !== '',
    matches: (e) => {
      const f = facetsOf(e)
      return (!kinds || (f.kind !== null && kinds.includes(f.kind))) && (!slots || (f.slot !== null && slots.includes(f.slot))) && matchText(q.text, f.text)
    },
  }
}

/** The filter with `stage` chosen when it was not, and dropped when it was: what a stage chip does. */
export function toggleStage(input: string, stage: Stage): string {
  const chosen = parse(input, activityQualifiers).terms.some((t) => t.name === 'stage' && t.values.includes(stage))
  return chosen ? withoutValue(input, 'stage', stage, activityQualifiers) : withValue(input, 'stage', stage, activityQualifiers)
}

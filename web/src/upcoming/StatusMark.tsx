// chrome: domain-visual
// Where an entry stands, as the Month grid's bare dot. The
// dots are the Slot chip's (see ../ui/slotState): a Wanted entry is amber, red only once Long Missing, a release to come grey.
import { StateDot, type SlotDotState } from '../ui/slotState'
import type { EntryStatus } from './state'

export type StatusKind = EntryStatus['kind']

const state = (kind: StatusKind, long: boolean): SlotDotState =>
  ({ searching: 'unreleased', downloading: 'downloading', imported: 'filled', missing: long ? 'long_missing' : 'wanted', unmonitored: 'unmonitored' })[kind] as SlotDotState

/** The dot of a status. `className` is its size, `size-2` by default. */
export function StatusDot({ kind, long = false, className }: { kind: StatusKind; long?: boolean; className?: string }) {
  return (
    <span data-status={kind} className="contents">
      <StateDot state={state(kind, long)} className={className} />
    </span>
  )
}

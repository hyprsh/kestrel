// chrome: domain-visual
// Where an entry stands, drawn the same on the Agenda, the Month grid and the phone: a dot and, beside it, the words. The
// dots are the Slot chip's (see ../ui/slotState): a Wanted entry is amber, red only once Long Missing, a release to come grey.
import { StateDot, type SlotDotState } from '../ui/slotState'
import type { EntryStatus } from './state'

export type StatusKind = EntryStatus['kind']

const state = (kind: StatusKind, long: boolean): SlotDotState =>
  ({ searching: 'unreleased', downloading: 'downloading', imported: 'filled', missing: long ? 'long_missing' : 'wanted', unmonitored: 'unmonitored' })[kind] as SlotDotState

const text = (kind: StatusKind, long: boolean) =>
  ({ searching: 'text-gray-900', downloading: 'text-blue-900', imported: 'text-green-900', missing: long ? 'text-red-900' : 'text-amber-900', unmonitored: 'text-gray-900' })[kind]

/** The dot of a status. `className` is its size, `size-2` by default. */
export function StatusDot({ kind, long = false, className }: { kind: StatusKind; long?: boolean; className?: string }) {
  return (
    <span data-status={kind} className="contents">
      <StateDot state={state(kind, long)} className={className} />
    </span>
  )
}

/** The dot with the status's words, in the status's colour. */
export function StatusMark({ status, className = 'label-13' }: { status: Pick<EntryStatus, 'kind' | 'label'> & { long?: boolean }; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className} ${text(status.kind, status.long ?? false)}`}>
      <StatusDot kind={status.kind} long={status.long} />
      {status.label}
    </span>
  )
}

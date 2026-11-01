// chrome: domain-visual
// Where an entry stands, drawn the same on the Agenda, the Month grid and the phone: a dot (a ring while it waits for its
// release) and, beside it, the words. The colours are the Month legend's.
import type { EntryStatus } from './state'

export type StatusKind = EntryStatus['kind']

const dot: Record<StatusKind, string> = {
  searching: 'ring-2 ring-inset ring-amber-700',
  downloading: 'bg-blue-700',
  imported: 'bg-green-700',
  missing: 'bg-red-700',
  unmonitored: 'bg-gray-500',
}
const text: Record<StatusKind, string> = {
  searching: 'text-amber-900',
  downloading: 'text-blue-900',
  imported: 'text-green-900',
  missing: 'text-red-900',
  unmonitored: 'text-gray-900',
}

/** The dot of a status. `size` is its diameter class. */
export function StatusDot({ kind, className = 'size-2' }: { kind: StatusKind; className?: string }) {
  return <span aria-hidden data-status={kind} className={`inline-block shrink-0 rounded-full ${className} ${dot[kind]}`} />
}

/** The dot with the status's words, in the status's colour. */
export function StatusMark({ status, className = 'label-13' }: { status: Pick<EntryStatus, 'kind' | 'label'>; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className} ${text[status.kind]}`}>
      <StatusDot kind={status.kind} />
      {status.label}
    </span>
  )
}

/** The legend under the Month grid: the five statuses with their dots. */
export function StatusLegend() {
  const all: [StatusKind, string][] = [
    ['searching', 'Searched when out'],
    ['downloading', 'Downloading'],
    ['imported', 'Imported'],
    ['missing', 'Out, not found yet'],
    ['unmonitored', 'Not monitored'],
  ]
  return (
    <ul aria-label="Legend" className="label-12 flex flex-wrap gap-x-4 gap-y-1 text-gray-900">
      {all.map(([kind, label]) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <StatusDot kind={kind} className="size-1.5" />
          {label}
        </li>
      ))}
    </ul>
  )
}

// chrome: layout
import type { ReactNode } from 'react'
import { NowBody, NowCard } from './NowCard'

/**
 * A dashboard card, in the Overview's one card (NowCard): the title, a grey `meta`, something at its far end (a legend, a badge)
 * and the padded body. `label` names the region. The Overview's charts, tables and figures each sit in one.
 */
export function StatCard({ title, meta, aside, label, children }: { title: string; meta?: ReactNode; aside?: ReactNode; label?: string; children: ReactNode }) {
  return (
    <NowCard title={title} label={label} meta={meta} aside={aside}>
      <NowBody>{children}</NowBody>
    </NowCard>
  )
}

/**
 * The headline figures as one card, split into cells by hairlines: two columns, five once the column is wide. An odd last cell
 * in two columns takes the whole row, so no empty cell shows.
 */
export function StatStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-gray-alpha-200 shadow-border @3xl:grid-cols-5">
      {children}
    </section>
  )
}

/** One headline figure of a StatStrip: a label, the value, and up to two lines under it (a bar and a note). */
export function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1 bg-background-100 p-4 last:odd:col-span-2 max-sm:gap-0.5 max-sm:px-4 max-sm:py-3 @3xl:last:odd:col-span-1">
      <span className="label-13 text-gray-900 max-sm:label-12">{label}</span>
      {children}
    </div>
  )
}

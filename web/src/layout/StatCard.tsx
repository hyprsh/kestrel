// chrome: layout
import type { ReactNode } from 'react'

/**
 * A dashboard card: a heading with something at its far end (a legend, a badge) and the body. `label` names the
 * region. The Overview's charts, tables and figures each sit in one.
 */
export function StatCard({ title, aside, label, children }: { title: string; aside?: ReactNode; label?: string; children: ReactNode }) {
  return (
    <section aria-label={label ?? title} className="flex min-w-0 flex-col gap-3 rounded-md p-4 shadow-border">
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="heading-16 m-0">{title}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One headline figure: a label, the value, and up to two lines under it (a bar and a note). */
export function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1 rounded-md px-4 py-3.5 shadow-border max-sm:gap-0.5 max-sm:p-3">
      <span className="label-13 text-gray-900 max-sm:label-12">{label}</span>
      {children}
    </div>
  )
}

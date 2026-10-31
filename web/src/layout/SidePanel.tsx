// chrome: layout
import type { ReactNode } from 'react'

/** A panel on the right of a wide screen that sums up what is picked on its left (the Library grid's Title): 420px, with a divider on its left. `label` names it. */
export function SidePanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside aria-label={label} className="flex w-[420px] min-w-0 shrink-0 flex-col border-l border-gray-alpha-400 bg-background-100">
      {children}
    </aside>
  )
}

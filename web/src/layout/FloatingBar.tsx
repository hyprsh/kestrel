// chrome: layout
import type { ReactNode } from 'react'

/**
 * A toolbar that floats over the foot of a list, such as the actions for the ticked rows. It sits in the nearest
 * positioned ancestor (a WideListPane, or a `relative` column), so the list keeps its place under it; give the list room
 * at its end while the bar shows. `label` names the toolbar.
 */
export function FloatingBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={label} className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-1.5 rounded-xl bg-background-100 py-2 pr-2 pl-3.5 shadow-menu">
      {children}
    </div>
  )
}

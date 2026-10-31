// chrome: layout
import type { ReactNode } from 'react'

/**
 * The bar that floats while rows are ticked: the count, the actions for the ticked rows and Clear. `label` names
 * the toolbar for a screen reader ("2 episodes ticked").
 *
 * - `overlay` (the default) floats over the foot of a list, in the nearest positioned ancestor (a WideListPane, or a
 *   `relative` column), so the list keeps its place under it; give the list room at its end while the bar shows.
 * - `sticky` sits last in a scrolling pane's content and sticks to its bottom edge, clear of the phone's tab bar,
 *   which the pane already stops above (the episode table on a Title page).
 */
export function FloatingBar({ label, placement = 'overlay', children }: { label: string; placement?: 'overlay' | 'sticky'; children: ReactNode }) {
  if (placement === 'sticky') {
    return (
      <div className="pointer-events-none sticky bottom-4 z-10 mt-4 flex justify-center">
        <div role="toolbar" aria-label={label} className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl bg-background-100 px-3 py-2 shadow-menu">
          {children}
        </div>
      </div>
    )
  }
  return (
    <div role="toolbar" aria-label={label} className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-1.5 rounded-xl bg-background-100 py-2 pr-2 pl-3.5 shadow-menu">
      {children}
    </div>
  )
}

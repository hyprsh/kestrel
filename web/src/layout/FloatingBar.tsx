// chrome: layout
import type { ReactNode } from 'react'

/**
 * The bar that floats at the bottom of a scrolling pane while rows are ticked: the count, the actions for the
 * ticked rows and Clear. It sits last in the pane's content and sticks to the bottom edge, clear of the phone's
 * tab bar, which the pane already stops above. `label` names the toolbar for a screen reader ("2 episodes ticked").
 */
export function FloatingBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 mt-4 flex justify-center">
      <div
        role="toolbar"
        aria-label={label}
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-gray-alpha-400 bg-background-100 px-3 py-2 shadow-md"
      >
        {children}
      </div>
    </div>
  )
}

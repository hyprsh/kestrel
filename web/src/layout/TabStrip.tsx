// chrome: layout
import type { ReactNode } from 'react'

/**
 * A full-width strip of primary Tabs under the top bar, with controls at its right end (a view switch, a "…" menu, an
 * add button). The tabs' own underline and the strip's run along the same pixel row, so the two read as one divider.
 */
export function TabStrip({ end, children }: { end: ReactNode; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-end gap-4 px-4 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-2 self-center">{end}</div>
    </div>
  )
}

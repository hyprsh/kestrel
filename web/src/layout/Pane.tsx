// chrome: layout
import type { ReactNode } from 'react'

/** The top of a pane: a title, controls or a search field, above a divider. `stacked` puts its parts on lines of their own, for a phone. */
export function PaneHeader({ children, stacked = false }: { children: ReactNode; stacked?: boolean }) {
  return <div className={`flex shrink-0 border-b border-gray-alpha-400 px-4 py-2.5 ${stacked ? 'flex-col items-stretch gap-2' : 'items-center gap-3'}`}>{children}</div>
}

/** The bottom of a pane: a status line or actions, under a divider. */
export function PaneFooter({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">{children}</footer>
}

// chrome: layout
import type { ReactNode } from 'react'

/** The top of a pane: a title, controls or a search field, above a divider. */
export function PaneHeader({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-3 border-b border-gray-alpha-400 px-4 py-2.5">{children}</div>
}

/** The bottom of a pane: a status line or actions, under a divider. */
export function PaneFooter({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">{children}</footer>
}

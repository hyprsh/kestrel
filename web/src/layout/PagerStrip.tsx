// chrome: layout
import type { ReactNode } from 'react'

/** The strip under a long list that holds its Pager, above the pane's footer. */
export function PagerStrip({ children }: { children: ReactNode }) {
  return <div className="shrink-0 border-t border-gray-alpha-400 px-4 py-2">{children}</div>
}

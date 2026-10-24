// chrome: layout
import type { ReactNode } from 'react'

/** The strip above a list that holds its filter field, tabs or filter menus. It wraps onto more rows on a phone. */
export function FilterStrip({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-alpha-400 px-4 py-2">{children}</div>
}

// chrome: layout
import type { ReactNode } from 'react'

/** The list column beside a detail pane on a wide screen: a fixed width with a divider on its right. */
export function ListPane({ children }: { children: ReactNode }) {
  return <aside className="flex w-72 min-w-0 shrink-0 flex-col border-r border-gray-alpha-400">{children}</aside>
}

// chrome: layout
import type { ReactNode } from 'react'

/**
 * The list column beside a detail pane when its rows carry more than a name (the Library's: poster, state line, Slot
 * dots and size): 440px, with a divider on its right. It is the containing block of a FloatingBar over its foot.
 */
export function WideListPane({ children }: { children: ReactNode }) {
  return <aside className="relative flex w-[440px] min-w-0 shrink-0 flex-col border-r border-gray-alpha-400 bg-background-200">{children}</aside>
}

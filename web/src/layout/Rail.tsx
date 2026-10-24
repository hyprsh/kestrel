// chrome: layout
import type { ReactNode } from 'react'

/** The desktop navigation rail: a narrow column of icon buttons on a raised surface, a divider on its right. */
export function Rail({ children }: { children: ReactNode }) {
  return <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-gray-alpha-400 bg-background-200 py-3">{children}</nav>
}

/** Takes the rail's free height, so what follows it sits at the bottom. */
export function RailSpacer() {
  return <div className="flex-1" />
}

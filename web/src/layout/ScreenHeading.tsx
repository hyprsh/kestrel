// chrome: layout
import type { ReactNode } from 'react'

/**
 * The heading of a desktop screen that has no SidePanel yet (Overview, Activity, Health, Log, Settings…): the screen name
 * as a line of text (as the top bar had it), above the content. A screen that has a SidePanel carries its name there and has no ScreenHeading.
 */
export function ScreenHeading({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-gray-alpha-400 px-4">
      <div className="heading-14 truncate">{children}</div>
    </header>
  )
}

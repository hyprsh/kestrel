// chrome: layout
import type { ReactNode } from 'react'

/** The app header on a phone, for a screen without a SidePanel: the screen title takes the width, then what runs, Health and Add. */
export function PhoneTopBar({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-alpha-400 pr-2 pl-4">
      <div className="heading-14 min-w-0 flex-1 truncate">{title}</div>
      {children}
    </header>
  )
}

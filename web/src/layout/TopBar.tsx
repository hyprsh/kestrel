// chrome: layout
import type { ReactNode } from 'react'

/** The app header on a phone: the screen title takes the width, then what runs and Add. */
export function PhoneTopBar({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-alpha-400 pr-2 pl-4">
      <div className="heading-14 min-w-0 flex-1 truncate">{title}</div>
      {children}
    </header>
  )
}

/** The app header on a desktop: three columns with equal side tracks, so the middle (the command box) stays centred whatever the right side holds. */
export function TopBar({ title, end, children }: { title: ReactNode; end: ReactNode; children: ReactNode }) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,460px)_minmax(0,1fr)] items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="heading-14 truncate">{title}</div>
      {children}
      <div className="flex min-w-0 items-center justify-end gap-4">{end}</div>
    </header>
  )
}

// chrome: layout
import type { ReactNode } from 'react'

/** A page of its own that is wide and long, such as the setup wizard: a column of cards on the page background that scrolls. */
export function WidePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full justify-center overflow-auto bg-background-200 p-8 copy-13 text-gray-1000">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  )
}

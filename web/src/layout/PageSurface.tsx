// chrome: layout
import type { ReactNode } from 'react'

/** A page of its own, outside the shell, such as Login or the setup wizard: a centred card on the page background. */
export function PageSurface({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background-200 p-4 text-gray-1000">
      <div className="flex w-full max-w-80 flex-col gap-4 rounded-lg border border-gray-alpha-400 bg-background-100 p-6 shadow-sm">{children}</div>
    </div>
  )
}

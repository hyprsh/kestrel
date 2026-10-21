// An Overview section: a heading with its count, at most five rows and a way to the rest.
// The cap is fixed (not fitted to the window), so the sections further down stay in view.
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'
import { cx } from '../ui'

const LIMIT = 5

/**
 * The rows a section shows. The Overview's j/k list is built from the same call, so the
 * selection runs through exactly the rows on screen.
 */
export const firstFive = <T,>(items: T[]): T[] => items.slice(0, LIMIT)

/** `count` is how many there are in all, shown after the title ("Downloading now · 23"). */
export function Section({
  id,
  title,
  count,
  className,
  children,
}: {
  id: string
  title: string
  count?: number
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={cx('mx-auto max-w-3xl', className)}>
      <h2 id={id} className="mb-3 text-sm font-medium">
        {count != null ? `${title} · ${count}` : title}
      </h2>
      {children}
    </section>
  )
}

/** "View all 23 →": opens the screen with the full list (a place path, such as "/activity"). */
export function ViewAll({ path, count }: { path: string; count?: number }) {
  const openPlace = useOpenPlace()
  return (
    <button type="button" className="mt-2 text-[12px] text-gray-900 hover:text-gray-1000 hover:underline" onClick={() => openPlace(path)}>
      {count != null ? `View all ${count} →` : 'View all →'}
    </button>
  )
}

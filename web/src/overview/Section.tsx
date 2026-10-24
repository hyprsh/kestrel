// An Overview section: a heading with its count, at most five rows and a way to the rest.
// The cap is fixed (not fitted to the window), so the sections further down stay in view.
import { EmptyState, Pill, ShowMore } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'

const LIMIT = 5

/**
 * The rows a section shows: the first five, in order, plus every row `keep` holds on to
 * (those count towards the five). The Overview's j/k list is built from the same call, so
 * the selection runs through exactly the rows on screen.
 */
export function firstFive<T>(items: T[], keep: (item: T) => boolean = () => false): T[] {
  let room = LIMIT - items.filter(keep).length
  return items.filter((item) => keep(item) || room-- > 0)
}

/** `count` is how many there are in all, shown after the title once there are any ("Downloading now · 23"). */
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
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="heading-14 mb-3">
        {count ? `${title} · ${count}` : title}
      </h2>
      {children}
    </section>
  )
}

/** "View all 23 →": opens the screen with the full list (a place path, such as "/activity"). */
export function ViewAll({ path, count }: { path: string; count?: number }) {
  const openPlace = useOpenPlace()
  return (
    <div className="mt-2">
      <Pill onClick={() => openPlace(path)}>{count != null ? `View all ${count} →` : 'View all →'}</Pill>
    </div>
  )
}

/** "View all 7" for a section with no screen of its own: it expands the section in place. */
export function ViewAllHere({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <div className="mt-2">
      <ShowMore noBorder expanded={open} moreLabel={`View all ${count}`} lessLabel="Show fewer" onClick={onToggle} />
    </div>
  )
}

/** The one line a section shows when it has nothing. */
export function EmptyLine({ title }: { title: string }) {
  return <EmptyState size="small" title={title} />
}

// An Overview section: a heading with its count, at most five rows and a way to the rest.
// The cap is fixed (not fitted to the window), so the sections further down stay in view.
import { Button } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'
import { cx } from '../ui'

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
    <section aria-labelledby={id} className={cx('mx-auto max-w-3xl', className)}>
      <h2 id={id} className="heading-14 mb-3">
        {count ? `${title} · ${count}` : title}
      </h2>
      {children}
    </section>
  )
}

const more = 'mt-2 -ml-3'

/** "View all 23 →": opens the screen with the full list (a place path, such as "/activity"). */
export function ViewAll({ path, count }: { path: string; count?: number }) {
  const openPlace = useOpenPlace()
  return (
    <Button variant="tertiary" size="small" className={more} onClick={() => openPlace(path)}>
      {count != null ? `View all ${count} →` : 'View all →'}
    </Button>
  )
}

/** "View all 7" for a section with no screen of its own: it expands the section in place. */
export function ViewAllHere({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <Button variant="tertiary" size="small" className={more} aria-expanded={open} onClick={onToggle}>
      {open ? 'Show fewer' : `View all ${count}`}
    </Button>
  )
}

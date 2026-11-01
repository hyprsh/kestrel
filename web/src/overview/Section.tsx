// An Overview section: a heading with its count, a few rows (five, or three in the compact lists) and a way to the rest.
// The cap is fixed (not fitted to the window), so the sections further down stay in view.
import { EmptyState, Link, ShowMore } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'

const LIMIT = 5
// The three lists under the dashboard are compact: three rows each.
const LIST = 3

/**
 * The rows a section shows: the first five, in order, plus every row `keep` holds on to
 * (those count towards the five). The Overview's j/k list is built from the same call, so
 * the selection runs through exactly the rows on screen.
 */
export function firstFive<T>(items: T[], keep: (item: T) => boolean = () => false): T[] {
  let room = LIMIT - items.filter(keep).length
  return items.filter((item) => keep(item) || room-- > 0)
}

/** The rows of Recently added, Recent requests and Coming this week: the first three. */
export const firstThree = <T,>(items: T[]): T[] => items.slice(0, LIST)

/**
 * `count` is how many there are in all, shown after the title once there are any ("Happening now · 23").
 * `action` is a link on the heading's far end, for a section whose way on is not "View all" below its rows.
 */
export function Section({ id, title, count, action, className, children }: { id: string; title: string; count?: number; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h2 id={id} className="heading-16">
          {count ? (
            <>
              {title} · <span className="label-13 text-gray-900">{count}</span>
            </>
          ) : (
            title
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The link on a heading's far end that opens the screen with the full list (a place path, such as "/upcoming"): "Library", "Requests". */
export function HeadingLink({ path, label }: { path: string; label: string }) {
  const openPlace = useOpenPlace()
  return (
    <Link as="button" type="button" className="label-13" aria-label={`Open ${label}`} onClick={() => openPlace(path)}>
      {label}
    </Link>
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

/** The one line a section shows when it has nothing, in the same card a row list draws, so the sections line up. */
export function EmptyLine({ title }: { title: string }) {
  return (
    <div className="hy-entity-list">
      <EmptyState size="small" title={title} />
    </div>
  )
}

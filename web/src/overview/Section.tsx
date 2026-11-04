// How many rows an Overview card shows: five, or three in the compact lists, and a way to expand a card that has no screen of
// its own. The cap is fixed (not fitted to the window), so the cards further down stay in view.
import { ShowMore } from '@hyprsh/design'

const LIMIT = 5
// The three lists under Happening now are compact: three rows each.
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

/** "View all 7" for a section with no screen of its own: it expands the section in place. */
export function ViewAllHere({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <div className="mt-2">
      <ShowMore noBorder expanded={open} moreLabel={`View All ${count}`} lessLabel="Show Fewer" onClick={onToggle} />
    </div>
  )
}

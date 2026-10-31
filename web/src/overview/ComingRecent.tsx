// "Recently added" (the latest Imports) and "Coming this week" (the next 7 days of Upcoming): two full-width
// poster shelves. Their posters are part of the Overview's one j/k selection (see OverviewNav).
import { Pill } from '@hyprsh/design'
import { SkeletonShelf } from '../loading'
import type { RecentItem, UpcomingItem } from '../api/upcoming'
import { localDay, useRecent, useUpcoming } from '../api/upcoming'
import { slotLabel, type SlotKey } from '../library/bits'
import { useOpenPlace } from '../place'
import { ago, useNow } from '../time'
import { airTime, dayLabel, episodeCode, upcomingKey } from '../upcoming/state'
import type { OverviewNav } from './nav'
import { EmptyLine, Section } from './Section'
import { Shelf, SHELF_MAX, type ShelfItem, type useShelfCount } from './Shelf'

type ShelfCount = ReturnType<typeof useShelfCount>

/** The week's items, cut to one row: what a shelf can show at its width. */
export const comingShown = (items: UpcomingItem[], count: number) => items.slice(0, Math.min(count, SHELF_MAX))
export const recentShown = (items: RecentItem[], count: number) => items.slice(0, Math.min(count, SHELF_MAX))

const comingLine = (item: UpcomingItem) => {
  const at = airTime(item)
  const day = at ? `${dayLabel(localDay(item))} ${at}` : dayLabel(localDay(item))
  return item.kind === 'series' && item.season != null && item.episode != null ? `${episodeCode(item.season, item.episode)} · ${day}` : day
}

function HeadingLink({ path, children }: { path: string; children: string }) {
  const openPlace = useOpenPlace()
  return <Pill onClick={() => openPlace(path)}>{children}</Pill>
}

/** Its posters come after "Recent requests" and "Recently added" in the j/k selection. */
export function Coming({ onOpenTitle, nav, shelf }: { onOpenTitle: (id: number) => void; nav: OverviewNav; shelf: ShelfCount }) {
  const coming = useUpcoming(6)
  const all = coming.data ?? []
  const items: ShelfItem[] = comingShown(all, shelf.count).map((item) => ({ key: upcomingKey(item), titleId: item.title_id, hasPoster: item.has_poster, name: item.title, line: comingLine(item) }))
  return (
    <Section id="coming-this-week" title="Coming this week" count={coming.data ? all.length : undefined} action={<HeadingLink path="/upcoming">Upcoming →</HeadingLink>}>
      {coming.isPending ? (
        <SkeletonShelf />
      ) : coming.data && all.length === 0 ? (
        <EmptyLine title="Nothing is due in the next 7 days." />
      ) : (
        <Shelf items={items} nav={nav} shelf={shelf} onOpen={onOpenTitle} />
      )}
    </Section>
  )
}

/** The count is the week's Imports, which the Done stage lists; the posters are the latest few. */
export function RecentlyAdded({ onOpenTitle, nav, shelf }: { onOpenTitle: (id: number) => void; nav: OverviewNav; shelf: ShelfCount }) {
  const recent = useRecent()
  const now = useNow()
  const all = recent.data?.items ?? []
  const items: ShelfItem[] = recentShown(all, shelf.count).map((item) => ({
    key: `${item.title_id}-${item.slot}-${item.imported_at}`,
    titleId: item.title_id,
    hasPoster: item.has_poster,
    name: item.title,
    line: `${slotLabel[item.slot as SlotKey]} · ${ago(item.imported_at, now)}`,
  }))
  return (
    <Section id="recently-added" title="Recently added" count={recent.data?.total} action={<HeadingLink path="/library">Library →</HeadingLink>}>
      {recent.isPending ? (
        <SkeletonShelf />
      ) : recent.data && all.length === 0 ? (
        <EmptyLine title="Nothing has been imported yet." />
      ) : (
        <Shelf items={items} nav={nav} shelf={shelf} onOpen={onOpenTitle} />
      )}
    </Section>
  )
}

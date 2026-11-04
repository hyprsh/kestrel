// "Recently added" (the latest Imports) and "Coming this week" (the next 7 days of Upcoming): compact cards like "Recent
// requests", three rows at most, each with a link in the header to its screen. Their rows are part of the Overview's one j/k
// selection (see OverviewNav).
import type { UpcomingItem } from '../api/upcoming'
import { localDay, useRecent, useUpcoming } from '../api/upcoming'
import type { ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { NowCard, NowEmpty, NowLine, NowList, NowRow, NowSkeletonRows, NowTitle } from '../layout/NowCard'
import { SlotPills, SlotTag } from '../library/SlotPills'
import { useSlotNames } from '../library/slots'
import { useOpenPlace } from '../place'
import { TitlePoster } from '../poster'
import { ago, useNow } from '../time'
import { dayLabel, entryChips, episodeCode, releaseName, upcomingKey } from '../upcoming/state'
import type { OverviewNav } from './nav'
import { firstThree } from './Section'

/** "S05E11 · Mon, Nov 2", or "Digital · Thu, Nov 5" for a Movie: the episode or the release, then the day. */
const comingLine = (item: UpcomingItem) => {
  const day = dayLabel(localDay(item))
  if (item.kind === 'series' && item.season != null && item.episode != null) return `${episodeCode(item.season, item.episode)} · ${day}`
  return item.release_type ? `${releaseName[item.release_type].split(' ')[0]} · ${day}` : day
}

type TitleRowItem = { key: string; titleId: number; hasPoster: boolean; name: string; line: string; right?: ReactNode }

/** The rows of a card whose items are Titles: poster, name and one line. `nav.base` is the first row's place in the j/k list. */
function TitleRows({ items, nav, onOpenTitle }: { items: TitleRowItem[]; nav: OverviewNav; onOpenTitle: (id: number) => void }) {
  return (
    <NowList>
      {items.map((item, j) => {
        const i = nav.base + j
        return (
          <NowRow
            key={item.key}
            navIndex={i}
            current={i === nav.sel}
            onSelect={() => nav.select(i)}
            onOpen={() => onOpenTitle(item.titleId)}
            lead={<TitlePoster id={item.titleId} hasPoster={item.hasPoster} size="xs" />}
            right={item.right}
          >
            <NowTitle name={item.name} />
            <NowLine>{item.line}</NowLine>
          </NowRow>
        )
      })}
    </NowList>
  )
}

/** Its rows come last in the j/k selection, after "Recent requests". */
export function Coming({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const coming = useUpcoming(6)
  const queue = useQueue().data ?? []
  const names = useSlotNames()
  const openPlace = useOpenPlace()
  const all = coming.data ?? []
  const items = firstThree(all).map((item) => ({
    key: upcomingKey(item),
    titleId: item.title_id,
    hasPoster: item.has_poster,
    name: item.title,
    line: comingLine(item),
    // An entry that is not out yet has nothing to say in a chip: every Slot would be Not out yet.
    right: item.slots.every((s) => s.state === 'not_out') ? undefined : <SlotPills chips={entryChips(item, queue, names)} max={3} label={`${item.title} Slots`} />,
  }))
  return (
    <NowCard
      title="Coming this week"
      label={coming.data && all.length > 0 ? `Coming this week · ${all.length}` : undefined}
      meta={coming.data && all.length > 0 ? all.length : undefined}
      link={all.length > 0 ? { label: 'Upcoming', onOpen: () => openPlace('/upcoming') } : undefined}
    >
      {coming.isPending ? (
        <NowSkeletonRows />
      ) : coming.data && all.length === 0 ? (
        <NowEmpty>Nothing is due in the next 7 days.</NowEmpty>
      ) : (
        <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />
      )}
    </NowCard>
  )
}

/** The count is the week's Imports, which the Done stage lists; the rows are the latest few. */
export function RecentlyAdded({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecent()
  const now = useNow()
  const openPlace = useOpenPlace()
  const all = recent.data?.items ?? []
  const items = firstThree(all).map((item) => ({
    key: `${item.title_id}-${item.slot}-${item.imported_at}`,
    titleId: item.title_id,
    hasPoster: item.has_poster,
    name: item.title,
    line: ago(item.imported_at, now),
    right: <SlotTag slot={item.slot} state="filled" />,
  }))
  return (
    <NowCard
      title="Recently added"
      label={recent.data?.total ? `Recently added · ${recent.data.total}` : undefined}
      meta={recent.data?.total || undefined}
      link={all.length > 0 ? { label: 'Library', onOpen: () => openPlace('/library') } : undefined}
    >
      {recent.isPending ? <NowSkeletonRows /> : recent.data && all.length === 0 ? <NowEmpty>Nothing has been imported yet.</NowEmpty> : <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />}
    </NowCard>
  )
}

// "Recently added" (the latest Imports) and "Coming this week" (the next 7 days of Upcoming): compact row lists
// like "Recent requests", five rows at most, each ending in a pill to its screen. Their rows are part of the
// Overview's one j/k selection (see OverviewNav).
import { Entity } from '@hyprsh/design'
import { RowList } from '../layout/RowList'
import { SkeletonRows } from '../loading'
import type { UpcomingItem } from '../api/upcoming'
import { localDay, useRecent, useUpcoming } from '../api/upcoming'
import type { ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { SlotChips, SlotTag } from '../library/SlotChip'
import { TitlePoster } from '../poster'
import { ago, useNow } from '../time'
import { dayLabel, entryChips, episodeCode, releaseName, upcomingKey } from '../upcoming/state'
import type { OverviewNav } from './nav'
import { EmptyLine, firstThree, HeadingLink, Section } from './Section'

/** "S05E11 · Mon, Nov 2", or "Digital · Thu, Nov 5" for a Movie: the episode or the release, then the day. */
const comingLine = (item: UpcomingItem) => {
  const day = dayLabel(localDay(item))
  if (item.kind === 'series' && item.season != null && item.episode != null) return `${episodeCode(item.season, item.episode)} · ${day}`
  return item.release_type ? `${releaseName[item.release_type].split(' ')[0]} · ${day}` : day
}

type TitleRowItem = { key: string; titleId: number; hasPoster: boolean; name: string; line: string; right?: ReactNode }

/** The rows of a section whose items are Titles: poster, name and one line. `nav.base` is the first row's place in the j/k list. */
function TitleRows({ items, nav, onOpenTitle }: { items: TitleRowItem[]; nav: OverviewNav; onOpenTitle: (id: number) => void }) {
  return (
    <RowList>
      {items.map((item, j) => {
        const i = nav.base + j
        return (
          <Entity
            key={item.key}
            as="button"
            current={i === nav.sel}
            data-nav={`ov-${i}`}
            onClick={() => {
              nav.select(i)
              onOpenTitle(item.titleId)
            }}
            left={<TitlePoster id={item.titleId} hasPoster={item.hasPoster} size="sm" />}
            right={item.right}
          >
            <Entity.Content fill title={<span className="font-medium">{item.name}</span>} description={item.line} />
          </Entity>
        )
      })}
    </RowList>
  )
}

/** Its rows come last in the j/k selection, after "Recent requests". */
export function Coming({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const coming = useUpcoming(6)
  const queue = useQueue().data ?? []
  const all = coming.data ?? []
  const items = firstThree(all).map((item) => ({
    key: upcomingKey(item),
    titleId: item.title_id,
    hasPoster: item.has_poster,
    name: item.title,
    line: comingLine(item),
    right: <SlotChips chips={entryChips(item, queue)} max={3} label={`${item.title} Slots`} />,
  }))
  return (
    <Section id="coming-this-week" title="Coming this week" count={coming.data ? all.length : undefined} action={all.length > 0 ? <HeadingLink path="/upcoming" label="Upcoming" /> : undefined}>
      {coming.isPending ? (
        <SkeletonRows poster="sm" />
      ) : coming.data && all.length === 0 ? (
        <EmptyLine title="Nothing is due in the next 7 days." />
      ) : (
        <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />
      )}
    </Section>
  )
}

/** The count is the week's Imports, which the Done stage lists; the rows are the latest few. */
export function RecentlyAdded({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecent()
  const now = useNow()
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
    <Section id="recently-added" title="Recently added" count={recent.data?.total} action={all.length > 0 ? <HeadingLink path="/library" label="Library" /> : undefined}>
      {recent.isPending ? (
        <SkeletonRows poster="sm" />
      ) : recent.data && all.length === 0 ? (
        <EmptyLine title="Nothing has been imported yet." />
      ) : (
        <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />
      )}
    </Section>
  )
}

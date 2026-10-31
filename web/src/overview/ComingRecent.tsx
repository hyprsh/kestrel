// "Recently added" (the latest Imports) and "Coming this week" (the next 7 days of Upcoming): compact row lists
// like "Recent requests", five rows at most, each ending in a pill to its screen. Their rows are part of the
// Overview's one j/k selection (see OverviewNav).
import { Entity } from '@hyprsh/design'
import { RowList } from '../layout/RowList'
import { SkeletonRows } from '../loading'
import type { UpcomingItem } from '../api/upcoming'
import { localDay, useRecent, useUpcoming } from '../api/upcoming'
import { slotLabel, type SlotKey } from '../library/bits'
import { TitlePoster } from '../poster'
import { ago, useNow } from '../time'
import { airTime, dayLabel, episodeCode, upcomingKey } from '../upcoming/state'
import type { OverviewNav } from './nav'
import { EmptyLine, firstFive, Section, ViewAll } from './Section'

const comingLine = (item: UpcomingItem) => {
  const at = airTime(item)
  const day = at ? `${dayLabel(localDay(item))} ${at}` : dayLabel(localDay(item))
  return item.kind === 'series' && item.season != null && item.episode != null ? `${episodeCode(item.season, item.episode)} · ${day}` : day
}

type TitleRowItem = { key: string; titleId: number; hasPoster: boolean; name: string; line: string }

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
  const all = coming.data ?? []
  const items = firstFive(all).map((item) => ({ key: upcomingKey(item), titleId: item.title_id, hasPoster: item.has_poster, name: item.title, line: comingLine(item) }))
  return (
    <Section id="coming-this-week" title="Coming this week" count={coming.data ? all.length : undefined}>
      {coming.isPending ? (
        <SkeletonRows poster="sm" />
      ) : coming.data && all.length === 0 ? (
        <EmptyLine title="Nothing is due in the next 7 days." />
      ) : (
        <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />
      )}
      {all.length > 0 && <ViewAll path="/upcoming" label="Upcoming →" />}
    </Section>
  )
}

/** The count is the week's Imports, which the Done stage lists; the rows are the latest few. */
export function RecentlyAdded({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecent()
  const now = useNow()
  const all = recent.data?.items ?? []
  const items = firstFive(all).map((item) => ({
    key: `${item.title_id}-${item.slot}-${item.imported_at}`,
    titleId: item.title_id,
    hasPoster: item.has_poster,
    name: item.title,
    line: `${slotLabel[item.slot as SlotKey]} · ${ago(item.imported_at, now)}`,
  }))
  return (
    <Section id="recently-added" title="Recently added" count={recent.data?.total}>
      {recent.isPending ? (
        <SkeletonRows poster="sm" />
      ) : recent.data && all.length === 0 ? (
        <EmptyLine title="Nothing has been imported yet." />
      ) : (
        <TitleRows items={items} nav={nav} onOpenTitle={onOpenTitle} />
      )}
      {all.length > 0 && <ViewAll path="/library" label="Library →" />}
    </Section>
  )
}

// "Coming this week" (the next 7 days of Upcoming) and "Recently added" (the latest Imports): two sections, in different columns.
// Their rows are part of the Overview's one j/k selection (see OverviewNav).
import { Badge, Entity } from '@hyprsh/design'
import { RowList, stackedRow, stackedRight } from '../layout/RowList'
import { useQueue } from '../api/queue'
import { localDay, useRecent, useUpcoming, type RecentItem } from '../api/upcoming'
import { slotLabel, type SlotKey } from '../library/bits'
import { placePath } from '../place'
import { useNow } from '../time'
import { UpcomingLine } from '../upcoming/bits'
import { dayLabel, upcomingKey } from '../upcoming/state'
import type { OverviewNav } from './nav'
import { EmptyLine, firstFive, Section, ViewAll } from './Section'

const openRow = (nav: OverviewNav, onOpenTitle: (id: number) => void) => (index: number, id: number) => {
  nav.select(index)
  onOpenTitle(id)
}

/** Its rows come after "Recently added" in the j/k selection: the main column is read before the side column. */
export function Coming({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const coming = useUpcoming(6)
  const queue = useQueue().data ?? []
  const now = useNow()
  const comingAll = coming.data ?? []
  const comingItems = firstFive(comingAll)
  const open = openRow(nav, onOpenTitle)
  return (
    <Section id="coming-this-week" title="Coming this week" count={coming.data ? comingAll.length : undefined}>
      {coming.data && comingItems.length === 0 ? (
        <EmptyLine title="Nothing is due in the next 7 days." />
      ) : (
        <Entity.List>
          {comingItems.map((item, j) => {
            const i = nav.base + j
            return (
              <Entity
                key={upcomingKey(item)}
                as="button"
                current={i === nav.sel}
                data-nav={`ov-${i}`}
                onClick={() => open(i, item.title_id)}
                left={<span className="label-12 w-24 shrink-0 text-gray-900 tabular">{dayLabel(localDay(item))}</span>}
              >
                <Entity.Content fill>
                  <UpcomingLine item={item} queue={queue} now={now} />
                </Entity.Content>
              </Entity>
            )
          })}
        </Entity.List>
      )}
      {comingAll.length > 0 && <ViewAll path="/upcoming" count={comingAll.length} />}
    </Section>
  )
}

/** The count is the week's Imports, which the Done stage lists; the rows are the latest few. */
export function RecentlyAdded({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const recent = useRecent()
  const recentItems = firstFive(recent.data?.items ?? [])
  const open = openRow(nav, onOpenTitle)
  return (
    <Section id="recently-added" title="Recently added" count={recent.data?.total}>
      {recent.data && recentItems.length === 0 ? (
        <EmptyLine title="Nothing has been imported yet." />
      ) : (
        <RowList>
          {recentItems.map((item, j) => {
            const i = nav.base + j
            return <RecentRow key={`${item.title_id}-${item.slot}-${item.imported_at}`} item={item} index={i} sel={nav.sel} onSelect={() => open(i, item.title_id)} />
          })}
        </RowList>
      )}
      {recentItems.length > 0 && <ViewAll path={placePath('activity', 'stage:done')} count={recent.data?.total || undefined} />}
    </Section>
  )
}

function RecentRow({ item, index, sel, onSelect }: { item: RecentItem; index: number; sel: number; onSelect: () => void }) {
  return (
    <Entity
      as="button"
      current={index === sel}
      data-nav={`ov-${index}`}
      onClick={onSelect}
      className={stackedRow}
      rightClassName={stackedRight}
      right={
        <>
          <Badge variant="gray" contrast="low" size="sm">
            {slotLabel[item.slot as SlotKey]}
          </Badge>
          {item.is_upgrade && (
            <Badge variant="purple" contrast="low" size="sm">
              Upgrade
            </Badge>
          )}
          {item.score != null && <span className="label-12 text-gray-900 tabular">{item.score}</span>}
          <span className="label-12 w-10 shrink-0 text-right tabular">{item.score_delta != null ? `+${item.score_delta}` : 'new'}</span>
          <span className="label-12 w-28 shrink-0 text-right text-gray-900">{new Date(item.imported_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
        </>
      }
    >
      <Entity.Content
        fill
        title={
          <>
            <span className="font-medium">{item.title}</span>
            {item.year ? <span className="font-normal text-gray-900"> {item.year}</span> : null}
            {item.files > 1 ? <span className="font-normal text-gray-900"> · {item.files} files</span> : null}
          </>
        }
        description={<span className="label-12-mono">{item.release_name}</span>}
      />
    </Entity>
  )
}

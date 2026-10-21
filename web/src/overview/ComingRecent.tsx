// "Coming this week" (the next 7 days of Upcoming) and "Recently added" (the latest Imports).
// Their rows are part of the Overview's one j/k selection (see OverviewNav).
import { useRecent, useUpcoming, type RecentItem } from '../api/upcoming'
import { slotLabel, type SlotKey } from '../library/bits'
import { placePath } from '../place'
import { Badge, NavRow } from '../ui'
import { dayLabel, UpcomingLine, upcomingKey } from '../upcoming/bits'
import type { OverviewNav } from './nav'
import { firstFive, Section, ViewAll } from './Section'

export function ComingRecent({ onOpenTitle, nav }: { onOpenTitle: (id: number) => void; nav: OverviewNav }) {
  const coming = useUpcoming(6)
  const recent = useRecent()
  const comingAll = coming.data ?? []
  const comingItems = firstFive(comingAll)
  const recentItems = firstFive(recent.data ?? [])
  const open = (index: number, id: number) => {
    nav.select(index)
    onOpenTitle(id)
  }

  return (
    <>
      <Section id="coming-this-week" title="Coming this week" count={coming.data ? comingAll.length : undefined} className="mt-6">
        {coming.data && comingItems.length === 0 ? (
          <p className="text-gray-900">Nothing is due in the next 7 days.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {comingItems.map((item, j) => {
              const i = nav.base + j
              return (
                <NavRow key={upcomingKey(item)} scope="ov" index={i} sel={nav.sel} onSelect={() => open(i, item.title_id)} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-24 shrink-0 text-[12px] text-gray-900 tabular">{dayLabel(item.date)}</span>
                  <UpcomingLine item={item} />
                </NavRow>
              )
            })}
          </ul>
        )}
        {comingAll.length > 0 && <ViewAll path="/upcoming" count={comingAll.length} />}
      </Section>
      {/* No count: GET /recent returns only the latest few Imports. */}
      <Section id="recently-added" title="Recently added" className="mt-6">
        {recent.data && recentItems.length === 0 ? (
          <p className="text-gray-900">Nothing has been imported yet.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {recentItems.map((item, j) => {
              const i = nav.base + comingItems.length + j
              return (
                <NavRow key={`${item.title_id}-${item.slot}-${item.imported_at}`} scope="ov" index={i} sel={nav.sel} onSelect={() => open(i, item.title_id)} className="flex items-center gap-3 px-4 py-2">
                  <RecentRow item={item} />
                </NavRow>
              )
            })}
          </ul>
        )}
        {recentItems.length > 0 && <ViewAll path={placePath('activity', 'stage:done')} />}
      </Section>
    </>
  )
}

function RecentRow({ item }: { item: RecentItem }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="font-medium">{item.title}</span>
          {item.year ? <span className="text-gray-900"> {item.year}</span> : null}
          {item.files > 1 ? <span className="text-gray-900"> · {item.files} files</span> : null}
        </span>
        <span className="block truncate font-mono text-[12px] text-gray-900">{item.release_name}</span>
      </span>
      <Badge>{slotLabel[item.slot as SlotKey]}</Badge>
      {item.is_upgrade && <Badge tone="purple">Upgrade</Badge>}
      {item.score != null && <span className="text-[12px] text-gray-900 tabular">{item.score}</span>}
      <span className="w-10 shrink-0 text-right text-[12px] tabular">{item.score_delta != null ? `+${item.score_delta}` : 'new'}</span>
      <span className="w-28 shrink-0 text-right text-[12px] text-gray-900">{new Date(item.imported_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
    </>
  )
}

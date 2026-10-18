// "Coming this week" (the next 7 days of Upcoming) and "Recently added" (the latest Imports).
// Their rows share one j/k/Enter selection, the Overview's `ov` scope.
import { useState } from 'react'
import { useRecent, useUpcoming, type RecentItem } from '../api/upcoming'
import { useListNav } from '../keys'
import { slotLabel, type SlotKey } from '../library/bits'
import { Badge, cx } from '../ui'
import { dayLabel, UpcomingLine } from '../upcoming/bits'

const rowClass = (selected: boolean) =>
  cx('flex cursor-pointer items-center gap-3 px-4 py-2', selected ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')

export function ComingRecent({ onOpenTitle }: { onOpenTitle: (id: number) => void }) {
  const coming = useUpcoming(6)
  const recent = useRecent()
  const comingItems = coming.data ?? []
  const recentItems = recent.data ?? []
  const ids = [...comingItems.map((i) => i.title_id), ...recentItems.map((i) => i.title_id)]
  const [sel, setSel] = useState(0)
  useListNav('ov', ids.length, sel, setSel, (i) => onOpenTitle(ids[i]))
  const open = (index: number, id: number) => {
    setSel(index)
    onOpenTitle(id)
  }

  return (
    <>
      <section aria-labelledby="coming-this-week" className="mx-auto mt-6 max-w-3xl">
        <h2 id="coming-this-week" className="mb-3 text-sm font-medium">
          Coming this week
        </h2>
        {coming.data && comingItems.length === 0 ? (
          <p className="text-gray-900">Nothing is due in the next 7 days.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {comingItems.map((item, i) => (
              <li
                key={`${item.kind}-${item.title_id}-${item.season ?? ''}-${item.episode ?? ''}-${item.release_type ?? ''}`}
                data-nav={`ov-${i}`}
                aria-current={i === sel ? 'true' : undefined}
                onClick={() => open(i, item.title_id)}
                className={rowClass(i === sel)}
              >
                <span className="w-24 shrink-0 text-[12px] text-gray-900 tabular">{dayLabel(item.date)}</span>
                <UpcomingLine item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="recently-added" className="mx-auto mt-6 max-w-3xl">
        <h2 id="recently-added" className="mb-3 text-sm font-medium">
          Recently added
        </h2>
        {recent.data && recentItems.length === 0 ? (
          <p className="text-gray-900">Nothing has been imported yet.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {recentItems.map((item, j) => {
              const i = comingItems.length + j
              return (
                <li key={`${item.title_id}-${item.slot}-${item.imported_at}`} data-nav={`ov-${i}`} aria-current={i === sel ? 'true' : undefined} onClick={() => open(i, item.title_id)} className={rowClass(i === sel)}>
                  <RecentRow item={item} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function RecentRow({ item }: { item: RecentItem }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{item.title}</span>
        {item.year ? <span className="text-gray-900"> {item.year}</span> : null}
        {item.files > 1 ? <span className="text-gray-900"> · {item.files} files</span> : null}
      </span>
      <Badge>{slotLabel[item.slot as SlotKey]}</Badge>
      {item.is_upgrade && <Badge tone="purple">Upgrade</Badge>}
      {item.score != null && <span className="text-[12px] text-gray-900 tabular">{item.score}</span>}
      <span className="w-28 shrink-0 text-right text-[12px] text-gray-900">{new Date(item.imported_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
    </>
  )
}

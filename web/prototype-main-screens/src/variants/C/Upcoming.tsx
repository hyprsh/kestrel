// PROTOTYPE, throwaway. Variant C Upcoming: dense agenda with a sticky date column.
import { useState } from 'react'
import { Film, Tv } from 'lucide-react'
import { go } from '../../nav'
import { TODAY, daysBetween, upcoming, type UpcomingItem } from '../../mock'
import { Badge, cx } from '../../ui'
import { useStore } from './store'
import { Page, SlotDots, fmtDate, fmtDay, useListNav } from './bits'

export function Upcoming() {
  const s = useStore()
  const [sel, setSel] = useState(0)
  const items = upcoming.filter((u) => u.date >= TODAY)
  const byDate = new Map<string, UpcomingItem[]>([[TODAY, []]])
  for (const u of items) byDate.set(u.date, [...(byDate.get(u.date) ?? []), u])
  useListNav('up', items.length, sel, setSel, (i) => go('library', { id: items[i].titleId }))

  let n = 0
  return (
    <Page>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Upcoming</h1>
          <p className="text-gray-900">Episodes and Movie releases expected soon · release dates for DE</p>
        </div>
        <span className="text-[12px] text-gray-900">{items.length} items</span>
      </div>
      <div className="rounded-lg border border-gray-alpha-400">
        {[...byDate].map(([date, list]) => {
          const d = daysBetween(TODAY, date)
          return (
            <div key={date} className="grid grid-cols-[9rem_1fr] border-b border-gray-alpha-400 last:border-b-0">
              <div className="sticky top-0 self-start px-3 py-2">
                <div className={cx('font-medium', d === 0 && 'text-blue-900')}>{fmtDay(date)}</div>
                <div className="text-[11px] text-gray-900">{d === 0 ? fmtDate(date) : d < 14 ? `in ${d} days` : fmtDate(date)}</div>
              </div>
              <div className="border-l border-gray-alpha-400">
                {list.length === 0 && <div className="px-3 py-2 text-gray-900">Nothing today.</div>}
                {list.map((u) => {
                  const i = n++
                  const t = s.titles.find((x) => x.id === u.titleId)!
                  const later = !u.searchable ? upcoming.find((x) => x.titleId === u.titleId && x.searchable && x.date > u.date) : undefined
                  return (
                    <div
                      key={i}
                      data-nav={`up-${i}`}
                      onClick={() => (setSel(i), go('library', { id: u.titleId }))}
                      className={cx('flex cursor-pointer items-center gap-3 border-b border-gray-alpha-400 px-3 py-2 last:border-b-0', i === sel ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')}
                    >
                      {t.kind === 'movie' ? <Film className="size-3.5 shrink-0 text-gray-700" /> : <Tv className="size-3.5 shrink-0 text-gray-700" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{u.label}</span>
                          <span className="truncate text-gray-900">{u.what}</span>
                        </div>
                        {later && (
                          <div className="text-[12px] text-amber-900">
                            Not searchable yet · searchable from {fmtDate(later.date)}
                          </div>
                        )}
                      </div>
                      {u.searchable ? <Badge tone="gray">Searches on release</Badge> : <Badge tone="amber">In cinemas only</Badge>}
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-gray-900">
                        {u.slots.join(' ')} <SlotDots t={t} only={u.slots} />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Page>
  )
}

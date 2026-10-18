// Upcoming: a dense agenda of the next 30 days, one sticky date column, j/k and Enter to open a Title.
import { useMemo, useState } from 'react'
import { useUpcoming, type UpcomingItem } from '../api/upcoming'
import { ErrorText } from '../forms'
import { useListNav } from '../keys'
import { NavRow } from '../ui'
import { dayLabel, UpcomingLine, upcomingKey } from './bits'

export function Upcoming({ onOpenTitle }: { onOpenTitle: (id: number) => void }) {
  const upcoming = useUpcoming(30)
  const items = useMemo(() => upcoming.data ?? [], [upcoming.data])
  const [sel, setSel] = useState(0)
  const days = useMemo(() => {
    const out: { day: string; items: { item: UpcomingItem; index: number }[] }[] = []
    items.forEach((item, index) => {
      const last = out.at(-1)
      if (last?.day === item.date) last.items.push({ item, index })
      else out.push({ day: item.date, items: [{ item, index }] })
    })
    return out
  }, [items])

  useListNav('up', items.length, sel, setSel, (i) => onOpenTitle(items[i].title_id))

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {upcoming.isError && <ErrorText>Upcoming could not be loaded.</ErrorText>}
      {upcoming.data && items.length === 0 && <div className="p-6 text-center text-gray-900">Nothing is due in the next 30 days.</div>}
      <ul aria-label="Agenda">
        {days.map((d) => (
          <li key={d.day} className="flex border-b border-gray-alpha-200">
            <div className="sticky top-0 w-28 shrink-0 self-start px-4 py-2 text-[12px] text-gray-900 tabular">{dayLabel(d.day)}</div>
            <ul aria-label={dayLabel(d.day)} className="min-w-0 flex-1">
              {d.items.map(({ item, index }) => (
                <NavRow
                  key={upcomingKey(item)}
                  scope="up"
                  index={index}
                  sel={sel}
                  onSelect={() => {
                    setSel(index)
                    onOpenTitle(item.title_id)
                  }}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <UpcomingLine item={item} />
                </NavRow>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

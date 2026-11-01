// chrome: domain-visual
// Upcoming's Month display: a header with the month's counts and ‹ Today ›, a Monday-first grid of days, each with up to
// three entries as pills (a status dot, the Title and the code) and "+N more", and a legend. A pill opens the Title; the day
// number and "+N more" switch to the Agenda at that day. Neighbouring months' days are dimmed.
import { Button } from '@hyprsh/design'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { localDay, type UpcomingItem } from '../api/upcoming'
import type { QueueItem } from '../api/queue'
import { plural } from '../format'
import { cx } from '../ui'
import { gridDays, shiftMonth } from './MonthCalendar'
import { StatusDot, StatusLegend } from './StatusMark'
import { addDays, entryStatus, episodeCode, releaseName, upcomingKey, weekdayShort, type EntryStatus } from './state'

const PILLS = 3

const dayName = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

/** The pill's text, and the tooltip and name that say all of it. */
function pillText(item: UpcomingItem, status: EntryStatus) {
  const code = item.kind === 'series' ? episodeCode(item.season!, item.episode!) : null
  const label = code ? `${item.title} ${code}` : item.title
  const what = item.kind === 'series' ? item.episode_name : item.release_type ? releaseName[item.release_type].toLowerCase() : null
  return { label, tip: `${label}${what ? ` · ${what}` : ''} — ${status.label}` }
}

export function MonthView({
  month,
  today,
  items,
  queue,
  onMonth,
  onToday,
  onDay,
  onOpenTitle,
}: {
  month: string
  today: string
  items: readonly UpcomingItem[]
  queue: readonly QueueItem[]
  onMonth: (month: string) => void
  onToday: () => void
  onDay: (day: string) => void
  onOpenTitle: (id: number) => void
}) {
  const byDay = new Map<string, UpcomingItem[]>()
  for (const i of items) byDay.set(localDay(i), [...(byDay.get(localDay(i)) ?? []), i])
  const inMonth = (day: string) => day.slice(0, 7) === month.slice(0, 7)
  const here = items.filter((i) => inMonth(localDay(i)))
  const searching = here.filter((i) => entryStatus(i, queue).kind === 'searching').length
  const title = new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return (
    <section aria-label="Month" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto px-8 py-6">
      <div className="flex items-baseline gap-3">
        <h2 className="heading-20">{title}</h2>
        <span className="label-14 text-gray-900">
          {plural(here.length, 'release')} · {searching} searched when out
        </span>
        <span className="flex-1" />
        <Button variant="tertiary" size="small" svgOnly aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <Button variant="secondary" size="small" onClick={onToday}>
          Today
        </Button>
        <Button variant="tertiary" size="small" svgOnly aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <div role="group" aria-label={`${title}, by day`} className="grid grid-cols-7 overflow-hidden rounded-md shadow-border">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} aria-hidden className="label-12 border-b border-gray-alpha-200 bg-background-200 px-2.5 py-2 text-gray-900">
            {weekdayShort(addDays('2026-11-02', i))}
          </span>
        ))}
        {gridDays(month).map((day) => {
          const all = byDay.get(day) ?? []
          const isToday = day === today
          const out = !inMonth(day)
          const n = Number(day.slice(8))
          return (
            <div
              key={day}
              data-day={day}
              data-out={out || undefined}
              className={cx('box-border flex min-h-[132px] min-w-0 flex-col gap-1 border-r border-b border-gray-alpha-200 p-2 [&:nth-child(7n)]:border-r-0', out && 'bg-background-200')}
            >
              <button
                type="button"
                aria-label={`${dayName(day)}${isToday ? ', today' : ''}${all.length > 0 ? `, ${plural(all.length, 'entry', 'entries')}` : ''}`}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onDay(day)}
                className={cx(
                  'label-12 inline-flex size-[22px] items-center justify-center self-start rounded-full font-medium tabular-nums',
                  isToday ? 'bg-gray-1000 text-background-100' : out ? 'text-gray-700' : 'text-gray-1000',
                )}
              >
                {n}
              </button>
              {all.slice(0, PILLS).map((item) => {
                const status = entryStatus(item, queue)
                const { label, tip } = pillText(item, status)
                return (
                  <button
                    key={upcomingKey(item)}
                    type="button"
                    title={tip}
                    aria-label={tip}
                    onClick={() => onOpenTitle(item.title_id)}
                    className="label-12 flex min-w-0 items-center gap-1.5 rounded-sm bg-gray-100 px-1.5 py-0.5 text-left hover:bg-gray-200"
                  >
                    <StatusDot kind={status.kind} className="size-1.5" />
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
              {all.length > PILLS && (
                <button type="button" onClick={() => onDay(day)} className="label-12 self-start px-1.5 text-gray-900 hover:text-gray-1000">
                  {`+${all.length - PILLS} more`}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <StatusLegend />
    </section>
  )
}

// chrome: domain-visual
// The month calendar of Upcoming's side panel: a weekday header, the weeks of one month (Monday first), today highlighted,
// days with releases marked by a blue dot under the number, and the week the Agenda shows shaded. Every day is a button named by its
// date; choosing one scrolls the agenda to it.
// No component of the design library draws a calendar (ADR 0017).
import { Button } from '@hyprsh/design'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dayString } from '../api/upcoming'
import { plural } from '../format'
import { cx } from '../ui'
import { addDays } from './state'

/** A month as its first day, YYYY-MM-01. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`

const at = (day: string) => new Date(`${day}T12:00:00`)

/** The first day of the month `by` months on. */
export const shiftMonth = (month: string, by: number) => {
  const d = at(month)
  return dayString(0, new Date(d.getFullYear(), d.getMonth() + by, 1, 12))
}

/** The last day of a month. */
export const monthEnd = (month: string) => {
  const d = at(month)
  return dayString(0, new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))
}

/** The months from `lo` to `hi`, both included. */
export function monthsBetween(lo: string, hi: string): string[] {
  const out: string[] = []
  for (let m = lo; m <= hi; m = shiftMonth(m, 1)) out.push(m)
  return out
}

/** The days the grid of a month shows: whole weeks, Monday to Sunday, with the neighbours' days at the ends. */
export function gridDays(month: string): string[] {
  const first = at(month)
  const lead = (first.getDay() + 6) % 7
  const count = Math.ceil((lead + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, i) => dayString(0, new Date(first.getFullYear(), first.getMonth(), 1 - lead + i, 12)))
}

/** Whether a day is in the week that starts on `first`. */
const inWeek = (day: string, first: string) => day >= first && day <= addDays(first, 6)

const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const name = (day: string) => at(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/**
 * `releases` counts the entries by day; a day with some gets a dot. `week` is the first day of the week the Agenda shows, shaded.
 * The month's name is the group's label, and the previous and next buttons move `month` (a YYYY-MM-01 day).
 */
export function MonthCalendar({
  month,
  today,
  week,
  releases,
  onMonth,
  onPick,
}: {
  month: string
  today: string
  week: string
  releases: ReadonlyMap<string, number>
  onMonth: (month: string) => void
  onPick: (day: string) => void
}) {
  const title = at(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return (
    <section aria-label="Calendar" className="flex flex-col gap-1.5 px-2.5 pt-3">
      <div className="flex items-center justify-between">
        <h2 className="label-14 font-semibold">{title}</h2>
        <span className="flex items-center gap-0.5">
          <Button variant="tertiary" size="tiny" svgOnly aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="tertiary" size="tiny" svgOnly aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </span>
      </div>
      <div role="group" aria-label={`${title}; the shown week is shaded, days with releases have a dot`} className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => (
          <span key={i} aria-hidden className="label-12 flex h-7 items-center justify-center text-gray-900">
            {w}
          </span>
        ))}
        {gridDays(month).map((day) => {
          const n = releases.get(day) ?? 0
          const inMonth = day.slice(0, 7) === month.slice(0, 7)
          return (
            <Button
              key={day}
              variant={day === today ? 'primary' : 'tertiary'}
              size="tiny"
              aria-label={`${name(day)}${day === today ? ', today' : ''}${n > 0 ? `, ${plural(n, 'release')}` : ''}`}
              aria-current={day === today ? 'date' : undefined}
              data-week={inWeek(day, week) || undefined}
              className={cx('relative w-full tabular-nums', !inMonth && day !== today && 'text-gray-700', inWeek(day, week) && day !== today && 'bg-gray-alpha-200')}
              onClick={() => onPick(day)}
            >
              {Number(day.slice(8))}
              {n > 0 && (
                <span aria-hidden data-testid="release-dot" className={cx('absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full', day === today ? 'bg-background-100' : 'bg-blue-700')} />
              )}
            </Button>
          )
        })}
      </div>
    </section>
  )
}

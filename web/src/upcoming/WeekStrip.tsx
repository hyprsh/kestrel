// chrome: domain-visual
// A phone's week strip: the seven days of the shown week as buttons with a dot where something is due. Today is marked and
// the shown day is filled; choosing one scrolls the agenda to it.
import { cx } from '../ui'
import { weekDays, weekdayShort } from './state'

const name = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

export function WeekStrip({ week, today, shown, releases, onPick }: { week: string; today: string; shown: string; releases: ReadonlyMap<string, number>; onPick: (day: string) => void }) {
  return (
    <div role="group" aria-label="This week" className="grid grid-cols-7 gap-1 pb-1">
      {weekDays(week).map((day) => {
        const n = releases.get(day) ?? 0
        const on = day === shown
        return (
          <button
            key={day}
            type="button"
            aria-label={`${name(day)}${day === today ? ', today' : ''}${n > 0 ? `, ${n} due` : ''}`}
            aria-pressed={on}
            aria-current={day === today ? 'date' : undefined}
            onClick={() => onPick(day)}
            className={cx('label-12 flex flex-col items-center gap-0.5 rounded-md py-1.5', on ? 'bg-gray-1000 text-background-100' : day === today ? 'text-gray-1000 shadow-border' : 'text-gray-900')}
          >
            {weekdayShort(day)}
            <b className={cx('text-[15px] leading-5 font-semibold', on ? 'text-background-100' : 'text-gray-1000')}>{Number(day.slice(8))}</b>
            <i data-testid="week-dot" data-due={n > 0 || undefined} aria-hidden className={cx('block size-1 rounded-full', n === 0 ? 'bg-transparent' : on ? 'bg-background-100' : 'bg-blue-700')} />
          </button>
        )
      })}
    </div>
  )
}

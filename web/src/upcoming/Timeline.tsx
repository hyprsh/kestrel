// chrome: domain-visual
// The Agenda timeline's drawing: the vertical rail, a dot per day and per row, the sticky day heading with
// today in the accent colour, the week label and the poster thumbnail beside a row. No component of the
// design library draws a timeline (ADR 0017); everything else in Upcoming is design components and layout.
import { Entity, Skeleton } from '@hyprsh/design'
import type { ReactNode, Ref } from 'react'
import { PosterSkeleton } from '../poster'
import { cx } from '../ui'

/** The Agenda: a list of days with the rail running down its left edge. */
export function AgendaTimeline({ children }: { children: ReactNode }) {
  return (
    <ul aria-label="Agenda" className="relative mt-2">
      <span aria-hidden className="absolute top-0 bottom-0 left-3 w-px bg-gray-alpha-400" />
      {children}
    </ul>
  )
}

/** The uppercase week label that opens a week on the rail. */
export function WeekLabel({ week }: { week: string }) {
  return (
    <li role="presentation" className="label-12 relative pt-4 pb-1 pl-9 font-medium tracking-wide text-gray-900 uppercase">
      {week}
    </li>
  )
}

/** A day's sticky heading with its dot on the rail; today is drawn in the accent colour with a rule after it. */
export function DayHeading({ label, date, isToday, headingRef }: { label: string; date: string; isToday: boolean; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <h3
      ref={headingRef}
      aria-current={isToday ? 'date' : undefined}
      className={cx('sticky top-0 z-10 flex items-center gap-2 bg-background-100 py-1.5 pl-9 label-14 font-medium', isToday && 'text-accent-900')}
    >
      <span aria-hidden className={cx('absolute top-1/2 left-[7px] -translate-y-1/2 rounded-full', isToday ? 'size-3 bg-accent-700 ring-4 ring-accent-700/20' : 'size-2 bg-gray-600')} />
      {label}
      {label !== date && <span className="label-12 font-normal text-gray-900">{date}</span>}
      {isToday && <span aria-hidden className="h-px flex-1 bg-accent-700/50" />}
    </h3>
  )
}

/** The rail's dot for a row: a child of the row's Entity, drawn left of the day card (the list lets it overflow). */
export function RowDot() {
  return <span aria-hidden className="absolute top-5 -left-7 size-2 rounded-full bg-gray-600 ring-4 ring-background-100" />
}

/** The Agenda while Upcoming loads: three days on the rail, each with a heading and a row or two. */
export function TimelineSkeleton() {
  return (
    <div aria-busy="true">
      <AgendaTimeline>
        {[2, 1, 2].map((rows, d) => (
          <li key={d} aria-hidden className="relative">
            <div className="flex items-center gap-2 py-1.5 pl-9">
              <span className="absolute top-3.5 left-[7px] size-2 rounded-full bg-gray-600" />
              <Skeleton width={96} height={16} />
            </div>
            <div className="pr-3 pb-2 pl-9">
              <Entity.List className="@container overflow-visible">
                {Array.from({ length: rows }, (_, i) => (
                  <Entity key={i} left={<PosterSkeleton size="sm" />}>
                    <Entity.Content fill title={<Skeleton width={`${45 + (((i + d) * 15) % 30)}%`} height={16} />} description={<Skeleton width="30%" height={14} />} />
                  </Entity>
                ))}
              </Entity.List>
            </div>
          </li>
        ))}
      </AgendaTimeline>
    </div>
  )
}

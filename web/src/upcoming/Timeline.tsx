// chrome: domain-visual
// The Agenda's drawing: a heading per day (the date and a muted "tomorrow") over one bordered card of that day's rows.
// Everything else in Upcoming is design components and layout.
import { Entity, Skeleton } from '@hyprsh/design'
import type { ReactNode, Ref } from 'react'
import { PosterSkeleton } from '../poster'

/** The Agenda: a list of days, 20px apart. */
export function AgendaTimeline({ children }: { children: ReactNode }) {
  return (
    <ul aria-label="Agenda" className="flex flex-col gap-5">
      {children}
    </ul>
  )
}

/** A day's heading: the date, with how far away it is in muted text beside it. */
export function DayHeading({ date, away, isToday, headingRef }: { date: string; away: string; isToday: boolean; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <h2 ref={headingRef} aria-current={isToday ? 'date' : undefined} className="heading-16">
      {date} <span className="label-14 font-normal text-gray-900">{away}</span>
    </h2>
  )
}

/**
 * The end of the Agenda that loads more: a row that says so while a chunk loads, or that nothing lies beyond; otherwise
 * an empty strip that `edgeRef` watches, so the next chunk loads before the reader gets there.
 */
export function AgendaEdge({ edgeRef, loading, end, loadingText, endText }: { edgeRef: Ref<HTMLDivElement>; loading: boolean; end: boolean; loadingText: string; endText: string }) {
  return (
    <div ref={edgeRef} role="status" className="label-13 flex min-h-8 items-center justify-center text-gray-900">
      {loading ? loadingText : end ? endText : null}
    </div>
  )
}

/** The bordered card that holds one day's rows. */
export function DayCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md shadow-border">{children}</div>
}

/** The Agenda while Upcoming loads: three days, each with a heading and a row or two. */
export function TimelineSkeleton() {
  return (
    <div aria-busy="true">
      <AgendaTimeline>
        {[2, 1, 2].map((rows, d) => (
          <li key={d} aria-hidden className="flex flex-col gap-2">
            <Skeleton width={96} height={20} />
            <DayCard>
              <Entity.List className="@container">
                {Array.from({ length: rows }, (_, i) => (
                  <Entity key={i} left={<PosterSkeleton size="sm" />}>
                    <Entity.Content fill title={<Skeleton width={`${45 + (((i + d) * 15) % 30)}%`} height={16} />} description={<Skeleton width="30%" height={14} />} />
                  </Entity>
                ))}
              </Entity.List>
            </DayCard>
          </li>
        ))}
      </AgendaTimeline>
    </div>
  )
}

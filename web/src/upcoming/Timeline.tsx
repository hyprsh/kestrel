// chrome: domain-visual
// The Agenda's drawing: per day, a date column (weekday, big number, how far away) beside one bordered card of that day's
// rows; a muted line for the stretches with nothing; the week header with its four stat cards. Everything else in Upcoming is
// design components and layout.
import { Button, Skeleton } from '@hyprsh/design'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { PosterSkeleton } from '../poster'
import { weekdayShort, type WeekStats } from './state'

/** The gap between a desktop's day blocks, in px (gap-3.5): the windowing adds it to the heights it estimates. */
export const DAY_GAP = 14

/**
 * The Agenda: a list of day blocks and quiet lines, 14px apart (a phone's day sections, 4). Only the days near the view are
 * drawn; `style` carries the height of the days not drawn above and below as padding, so the scrollbar stays true.
 */
export function AgendaTimeline({
  compact,
  children,
  listRef,
  style,
  spaced = true,
}: {
  compact: boolean
  children: ReactNode
  listRef?: Ref<HTMLOListElement>
  style?: CSSProperties
  spaced?: boolean
}) {
  return (
    <ol ref={listRef} aria-label="Agenda" style={style} className={compact || !spaced ? 'flex flex-col' : 'flex flex-col gap-3.5'}>
      {children}
    </ol>
  )
}

/**
 * A day on a desktop: its date at the left, the card of its rows at the right. A day with many rows is drawn in parts that
 * are one card (`continued` parts have no date). `padded` is the 14px under it when the list does not space its blocks.
 */
export function DayBlock({
  day,
  num,
  away,
  isToday,
  continued = false,
  padded = false,
  children,
  ...rest
}: { day: string; num: number; away: string; isToday: boolean; continued?: boolean; padded?: boolean; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <li className={`grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 ${padded ? 'pb-3.5' : ''}`} {...rest}>
      {continued ? (
        <div aria-hidden />
      ) : (
        <div aria-hidden className="flex flex-col items-start pt-2.5">
          <span className={`label-12 font-semibold uppercase ${isToday ? 'text-gray-1000' : 'text-gray-900'}`}>{weekdayShort(day)}</span>
          <span className="heading-24 tabular-nums">{num}</span>
          <span className="label-12 text-gray-900">{away}</span>
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </li>
  )
}

/** A phone's day section: the date and how far away it is over its rows. */
export function PhoneDay({ heading, away, continued = false, children, ...rest }: { heading: string; away: string; continued?: boolean; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <li {...rest}>
      {!continued && (
        <h2 className="label-13 px-4 pt-3 pb-1.5 font-semibold">
          {heading} <span className="font-normal text-gray-900">{away}</span>
        </h2>
      )}
      {children}
    </li>
  )
}

/** The line for days with nothing: "Nothing on Tue 3, Fri 6 – Sun 8", under the date column on a desktop. */
export function QuietLine({ text, compact, padded = false, ...rest }: { text: string; compact: boolean; padded?: boolean } & Record<`data-${string}`, string>) {
  return (
    <li className={compact ? 'px-4 py-2' : `grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 ${padded ? 'pb-3.5' : ''}`} {...rest}>
      {!compact && <span />}
      <span className="label-13 px-0.5 py-1 text-gray-900">{text}</span>
    </li>
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
export function DayCard({ label, part = 'only', children }: { label: string; part?: 'only' | 'first' | 'middle' | 'last'; children: ReactNode }) {
  const round = { only: 'rounded-md', first: 'rounded-t-md', middle: '', last: 'rounded-b-md' }[part]
  return (
    <ul aria-label={label} className={`overflow-hidden shadow-border ${round}`}>
      {children}
    </ul>
  )
}

/** The week header: "This week", its dates and ‹ Today › on one line, the four stat cards under it. */
export function WeekHeader({ title, range, stats, onPrev, onToday, onNext }: { title: string; range: string; stats: WeekStats; onPrev: () => void; onToday: () => void; onNext: () => void }) {
  return (
    <section aria-label="Week" className="flex flex-col gap-2.5 px-8 pt-6 pb-3">
      <div className="flex items-baseline gap-3">
        <h2 className="heading-20">{title}</h2>
        <span className="label-14 text-gray-900">{range}</span>
        <span className="flex-1" />
        <Button variant="tertiary" size="small" svgOnly aria-label="Previous Week" onClick={onPrev}>
          <ChevronLeft />
        </Button>
        <Button variant="secondary" size="small" onClick={onToday}>
          Today
        </Button>
        <Button variant="tertiary" size="small" svgOnly aria-label="Next Week" onClick={onNext}>
          <ChevronRight />
        </Button>
      </div>
      <ul aria-label="The week in numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat n={stats.episodes} label={stats.episodes === 1 ? 'episode airing' : 'episodes airing'} />
        <Stat n={stats.movies} label={stats.movies === 1 ? 'Movie released' : 'Movies released'} />
        <Stat n={stats.searching} label="searched when out" tone="text-amber-900" />
        <Stat n={stats.imported} label="already in the Library" tone="text-green-900" />
      </ul>
    </section>
  )
}

function Stat({ n, label, tone = '' }: { n: number; label: string; tone?: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 rounded-md px-4 py-3 shadow-border">
      <span className={`heading-24 tabular-nums ${tone}`}>{n}</span>
      <span className="label-13 text-gray-900">{label}</span>
    </li>
  )
}

/** The Agenda while Upcoming loads: three days, each with a date and a row or two. */
export function TimelineSkeleton() {
  return (
    <div aria-busy="true">
      <AgendaTimeline compact={false}>
        {[2, 1, 2].map((rows, d) => (
          <li key={d} aria-hidden className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4">
            <Skeleton width={40} height={48} />
            <div className="overflow-hidden rounded-md shadow-border">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <PosterSkeleton size="sm" />
                  <Skeleton width={`${45 + (((i + d) * 15) % 30)}%`} height={16} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </AgendaTimeline>
    </div>
  )
}

// chrome: domain-visual
// The Log's strip: how many events happened in each 4 hours of the last days, as stacked columns (events gray, warnings amber,
// errors red). Each column is the mark and its hit target: hovering or focusing it reads out its counts, clicking it jumps the
// list to that time. The red and amber are the Log's own status colours (Errors, Warnings) and mean nothing else here.
import { useState, type KeyboardEvent } from 'react'
import type { EventsHistogram } from '../api/log'
import { plural } from '../format'

type Bucket = EventsHistogram['buckets'][number]

const BUCKET_MS = 4 * 3_600_000
const HEIGHT = 56

const total = (b: Bucket) => b.events + b.warnings + b.errors

/** The strip's totals: every event, and how many of them were warnings and errors. */
export function stripTotals(buckets: readonly Bucket[]) {
  const sum = { events: 0, warnings: 0, errors: 0 }
  for (const b of buckets) {
    sum.events += total(b)
    sum.warnings += b.warnings
    sum.errors += b.errors
  }
  return sum
}

/** "874 events · 3 errors · 12 warnings". */
function stripSummary(buckets: readonly Bucket[]): string {
  const t = stripTotals(buckets)
  return `${plural(t.events, 'event')} · ${plural(t.errors, 'error')} · ${plural(t.warnings, 'warning')}`
}

/** The heading over the strip: it follows how many days the data covers. */
const stripHeading = (days: number) => (days <= 1 ? 'Today' : `Last ${days} days`)

const day = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const hm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** "Oct 30, 16:00 to 20:00". */
function bucketTime(b: Bucket): string {
  const from = new Date(b.at)
  const to = new Date(from.getTime() + BUCKET_MS)
  return `${day(from)}, ${hm(from)} to ${hm(to)}`
}

/** What the strip says to a screen reader: the totals, then where the errors and the warnings were. */
function stripAlternative(buckets: readonly Bucket[], days: number): string {
  const where = (pick: (b: Bucket) => number) =>
    buckets
      .filter((b) => pick(b) > 0)
      .map((b) => `${day(new Date(b.at))} at ${hm(new Date(b.at))}`)
      .join(', ')
  const errors = where((b) => b.errors)
  const warnings = where((b) => b.warnings)
  return [
    `Events per 4 hours over the last ${plural(days, 'day')}: ${stripSummary(buckets)}.`,
    errors ? `Errors on ${errors}.` : 'No errors.',
    warnings ? `Warnings on ${warnings}.` : 'No warnings.',
  ].join(' ')
}

/** The columns that start a day, for the axis: at most about four, each with its position as a share of the strip. */
function axis(buckets: readonly Bucket[], now: number): { at: number; label: string }[] {
  const starts: number[] = []
  buckets.forEach((b, i) => {
    if (i === 0 || new Date(b.at).getDate() !== new Date(buckets[i - 1].at).getDate()) starts.push(i)
  })
  const step = Math.max(1, Math.ceil(starts.length / 4))
  const today = new Date(now).toDateString()
  return starts
    .filter((_, k) => k % step === 0)
    .map((i) => {
      const d = new Date(buckets[i].at)
      return { at: i / buckets.length, label: d.toDateString() === today ? 'Today' : day(d) }
    })
}

function Key({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-2.5 rounded-xs ${className}`} />
}

/**
 * `buckets` oldest first (GET /events/histogram). `onJump` gets the time a clicked column starts. The strip describes the
 * whole Log, not the filter, so it keeps its shape while the list is filtered.
 */
export function Strip({ buckets, days, now, onJump }: { buckets: readonly Bucket[]; days: number; now: number; onJump: (from: Date, to: Date) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState(Math.max(buckets.length - 1, 0))
  const max = Math.max(1, ...buckets.map(total))
  const px = (n: number) => (n === 0 ? 0 : Math.max(3, Math.round((n / max) * HEIGHT)))
  const move = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null || next < 0 || next >= buckets.length) return
    e.preventDefault()
    setFocus(next)
    ;(e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
  }
  const shown = hover === null ? null : buckets[hover]
  return (
    <section aria-label="Events over time" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="heading-16 m-0">{stripHeading(days)}</h2>
        <span className="label-13 text-gray-900">{stripSummary(buckets)}</span>
        <span className="flex-1" />
        <span className="label-12 inline-flex gap-3 text-gray-900" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <Key className="bg-gray-500" />
            Events
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Key className="bg-amber-700" />
            Warnings
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Key className="bg-red-700" />
            Errors
          </span>
        </span>
      </div>
      <div className="relative">
        <div role="group" aria-label={stripAlternative(buckets, days)} className="flex items-end justify-center gap-0.5" style={{ height: HEIGHT }} onPointerLeave={() => setHover(null)}>
          {buckets.map((b, i) => (
            <button
              key={b.at}
              type="button"
              data-bucket={b.at}
              tabIndex={i === focus ? 0 : -1}
              aria-label={`${bucketTime(b)}: ${plural(b.events, 'event')}, ${plural(b.warnings, 'warning')}, ${plural(b.errors, 'error')}`}
              className={`flex h-full max-w-6 flex-1 cursor-pointer flex-col-reverse justify-start gap-0.5 rounded-t-sm bg-transparent p-0 outline-offset-2 ${hover === i ? 'opacity-70' : ''}`}
              onClick={() => onJump(new Date(b.at), new Date(new Date(b.at).getTime() + BUCKET_MS))}
              onPointerEnter={() => setHover(i)}
              onFocus={() => {
                setHover(i)
                setFocus(i)
              }}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => move(e, i)}
            >
              <span aria-hidden className="block rounded-t-xs bg-gray-500" style={{ height: px(b.events) }} />
              <span aria-hidden className="block rounded-t-xs bg-amber-700" style={{ height: px(b.warnings) }} />
              <span aria-hidden className="block rounded-t-xs bg-red-700" style={{ height: px(b.errors) }} />
            </button>
          ))}
        </div>
        {shown && hover !== null && (
          <div
            role="tooltip"
            className="label-12 pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-background-100 px-2.5 py-1.5 whitespace-nowrap shadow-border-medium"
            style={{ left: `clamp(80px, ${((hover + 0.5) / buckets.length) * 100}%, calc(100% - 80px))` }}
          >
            <div className="text-gray-900">{bucketTime(shown)}</div>
            {(
              [
                ['bg-gray-500', shown.events, 'events'],
                ['bg-amber-700', shown.warnings, 'warnings'],
                ['bg-red-700', shown.errors, 'errors'],
              ] as const
            ).map(([color, n, name]) => (
              <div key={name} className="flex items-center gap-2">
                <span aria-hidden className={`inline-block h-0.5 w-3 ${color}`} />
                <b className="tabular text-gray-1000">{n.toLocaleString()}</b>
                <span className="text-gray-900">{name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div aria-hidden className="label-12 relative h-4 text-gray-900">
        {axis(buckets, now).map((a) => (
          <span key={a.label + a.at} className="absolute" style={{ left: `${a.at * 100}%` }}>
            {a.label}
          </span>
        ))}
      </div>
    </section>
  )
}

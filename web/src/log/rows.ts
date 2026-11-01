// The Log's list as rows: events grouped by day, with consecutive routine events folded into one row.
import type { LogEvent } from '../api/log'

/** A row of the list: one event, or a run of routine events folded into one. */
export type Row = { type: 'event'; id: number; e: LogEvent } | { type: 'fold'; id: number; events: LogEvent[] }

/** The local calendar day of a time, as `2026-10-17`. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Today", "Yesterday", or the date: "Fri, Oct 30", with the year when it is not this one. */
export function dayLabel(key: string, now: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((startOfToday.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(y !== today.getFullYear() && { year: 'numeric' }) })
}

/**
 * The rows for `events` in the order given. Routine events that follow each other on one day fold into one row when there are
 * two or more of them; a lone routine event is a row of its own.
 */
export function foldRows(events: readonly LogEvent[]): Row[] {
  const rows: Row[] = []
  let run: LogEvent[] = []
  const flush = () => {
    if (run.length === 1) rows.push({ type: 'event', id: run[0].id, e: run[0] })
    else if (run.length > 1) rows.push({ type: 'fold', id: run[0].id, events: run })
    run = []
  }
  for (const e of events) {
    if (e.routine && (run.length === 0 || dayKey(run[0].at) === dayKey(e.at))) {
      run.push(e)
      continue
    }
    flush()
    if (e.routine) run.push(e)
    else rows.push({ type: 'event', id: e.id, e })
  }
  flush()
  return rows
}

/** When a row happened: its first event's time. */
const rowAt = (r: Row): string => (r.type === 'event' ? r.e.at : r.events[0].at)

/** The rows split into their days, in order, each day with its heading. */
export function byDay(rows: readonly Row[], now: number): { key: string; label: string; rows: Row[] }[] {
  const days: { key: string; label: string; rows: Row[] }[] = []
  for (const r of rows) {
    const key = dayKey(rowAt(r))
    const last = days.at(-1)
    if (last?.key === key) last.rows.push(r)
    else days.push({ key, label: dayLabel(key, now), rows: [r] })
  }
  return days
}

/** The time of day of an event: "13:02". */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

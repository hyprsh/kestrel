// The logic behind the Upcoming agenda and the Overview's Coming section: where an entry stands
// (a Grab in flight overrides what the server says), the week the agenda shows, day labels and the views.
import type { QueueItem } from '../api/queue'
import { localDay, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
import { percent } from '../format'
import { phases } from '../grabs/phase'

/** "S02E04". */
export const episodeCode = (season: number, episode: number) => `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`

/** A stable React key for a timeline line. */
export const upcomingKey = (item: UpcomingItem) => `${item.kind}-${item.title_id}-${item.season ?? ''}-${item.episode ?? ''}-${item.release_type ?? ''}`

export type Standing = { kind: 'not_out' } | { kind: 'wanted'; since: string | null; long: boolean } | { kind: 'grabbed'; grab: QueueItem } | { kind: 'imported'; quality: string | null }

type Titled = Pick<UpcomingItem, 'kind' | 'title_id' | 'season' | 'episode'>

/**
 * Where one Version stands for an entry. The server knows not out, Wanted and Imported; a Grab in
 * flight is live state, read off the queue, and takes over from Wanted.
 */
export function standing(item: Titled, slot: UpcomingSlot, queue: readonly QueueItem[]): Standing {
  if (slot.state === 'imported') return { kind: 'imported', quality: slot.quality }
  const code = item.kind === 'series' && item.season != null && item.episode != null ? episodeCode(item.season, item.episode) : null
  const grab = queue.find((g) => g.title_id === item.title_id && g.slot === slot.slot && (code === null || g.episodes.includes(code)))
  if (grab) return { kind: 'grabbed', grab }
  if (slot.state === 'wanted') return { kind: 'wanted', since: slot.wanted_since, long: slot.long_missing }
  return { kind: 'not_out' }
}

/** "1080p" out of "WEBDL-1080p"; the name as it is when it holds no resolution. */
export function resolutionOf(quality: string): string {
  return /(\d{3,4}p)/i.exec(quality)?.[1] ?? quality
}

/** How long something has been Wanted: "5 h", "2 days". */
export function wantedFor(since: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(since)) / 3_600_000))
  if (hours < 1) return 'under an hour'
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** "21:00" in the browser's time zone and locale clock; null when the entry has no air time. */
export function airTime(item: Pick<UpcomingItem, 'air_at'>): string | null {
  return item.air_at ? new Date(item.air_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : null
}

// Days are YYYY-MM-DD strings; arithmetic on them goes through UTC so a DST change cannot shift one.
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/** Days from `today` to `day`: negative for the past. */
const daysFrom = (today: string, day: string) => dayNumber(day) - dayNumber(today)

const dated = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Sat 18 Oct" for a YYYY-MM-DD day. */
export const dayLabel = dated

/** The day `n` days after (or before, when negative) a YYYY-MM-DD day. */
export const addDays = (day: string, n: number) => new Date((dayNumber(day) + n) * 86_400_000).toISOString().slice(0, 10)

/** The Monday of the week a day is in. */
export const weekStart = (day: string) => addDays(day, -((dayNumber(day) + 3) % 7))

/** The seven days of the week that starts on `monday`. */
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

const utc = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })

/** "Oct 11" for a YYYY-MM-DD day. */
const monthDay = (day: string) => utc(day, { month: 'short', day: 'numeric' })

/** "Nov 2 – 8", or "Oct 26 – Nov 1" across months: the dates of the week that starts on `monday`. */
export function weekRange(monday: string): string {
  const end = addDays(monday, 6)
  return `${monthDay(monday)} – ${monday.slice(5, 7) === end.slice(5, 7) ? Number(end.slice(8)) : monthDay(end)}`
}

/** What the agenda's header calls a week: This week, Next week, Last week, else "Week of Nov 9". */
export function weekTitle(today: string, monday: string): string {
  const by = daysFrom(weekStart(today), monday) / 7
  if (by === 0) return 'This week'
  if (by === 1) return 'Next week'
  if (by === -1) return 'Last week'
  return `Week of ${monthDay(monday)}`
}

/** "Mon, Nov 2": the heading of a day on the phone's agenda. */
export const headingDate = (day: string) => utc(day, { weekday: 'short', month: 'short', day: 'numeric' })

/** "Mon" for a day. */
export const weekdayShort = (day: string) => utc(day, { weekday: 'short' })

/** How far a day is from today, in words under its heading: today, tomorrow, in 3 days, yesterday, 3 days ago. */
export function daysAway(today: string, day: string): string {
  const d = daysFrom(today, day)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  return d > 0 ? `in ${d} days` : `${-d} days ago`
}

/** Where an entry stands as the agenda says it, one word for the whole entry however many Versions it has. */
export type EntryStatus = {
  kind: 'searching' | 'downloading' | 'imported' | 'missing' | 'unmonitored'
  label: string
  /** The Versions that are Wanted and not being downloaded: what Search now would look for. */
  wanted: UpcomingSlot[]
}

/**
 * The entry's status. A Grab in flight comes first, then a Version that is out and not found, then one that waits for its
 * release (Kestrel searches the moment it is out), then Imported; an entry that is not monitored and has no file in every
 * Version is Not monitored whatever the server says of its Versions.
 */
export function entryStatus(item: UpcomingItem, queue: readonly QueueItem[]): EntryStatus {
  const all = item.slots.map((slot) => ({ slot, st: standing(item, slot, queue) }))
  const wanted = all.filter((x) => x.st.kind === 'wanted').map((x) => x.slot)
  const grabbed = all.find((x) => x.st.kind === 'grabbed')
  const imported = all.length > 0 && all.every((x) => x.st.kind === 'imported')
  if (!imported && item.monitored === false) return { kind: 'unmonitored', label: 'Not monitored', wanted: [] }
  if (grabbed && grabbed.st.kind === 'grabbed') {
    const g = grabbed.st.grab
    const pct = g.phase === 'importing' ? null : percent(g.bytes_total, g.bytes_left)
    return { kind: 'downloading', label: g.phase === 'downloading' && pct !== null ? `Downloading · ${pct}%` : phases[g.phase].label, wanted }
  }
  if (wanted.length > 0) return { kind: 'missing', label: 'Out · not found yet', wanted }
  if (imported) return { kind: 'imported', label: 'Imported', wanted }
  return { kind: 'searching', label: 'Searched when out', wanted }
}

/** What a week adds up to: the episodes airing, the Movie releases, and how many entries wait for their release or are in the Library. */
export type WeekStats = { episodes: number; movies: number; searching: number; imported: number }

export function weekStats(items: readonly UpcomingItem[], monday: string, queue: readonly QueueItem[]): WeekStats {
  const end = addDays(monday, 6)
  const out: WeekStats = { episodes: 0, movies: 0, searching: 0, imported: 0 }
  for (const item of items) {
    const day = localDay(item)
    if (day < monday || day > end) continue
    if (item.kind === 'series') out.episodes++
    else out.movies++
    const { kind } = entryStatus(item, queue)
    if (kind === 'searching') out.searching++
    else if (kind === 'imported') out.imported++
  }
  return out
}

const releaseNoun = { theatrical: 'the cinema release', digital: 'digital', physical: 'physical' } as const
/** What a Movie's entry is: "Digital release". */
export const releaseName = { theatrical: 'Cinema release', digital: 'Digital release', physical: 'Physical release' } as const

/**
 * Which release Kestrel waits for, and the dates around it: "Waiting for digital · theatrical was Oct 11" while it is to
 * come, "Today · physical Dec 1" or "Out Oct 20 · physical Dec 1" once it is out (with the next release after it, if any).
 */
export function movieWhen(item: UpcomingItem, today: string): string {
  const type = item.release_type
  if (!type) return ''
  const others = item.dates.filter((d) => d.release_type !== type)
  if (item.date > today) {
    const before = others.find((d) => d.release_type === 'theatrical') ?? others.find((d) => d.date < item.date)
    return `Waiting for ${releaseNoun[type]}${before ? ` · ${before.release_type} ${before.date <= today ? 'was' : 'is'} ${monthDay(before.date)}` : ''}`
  }
  const next = others.find((d) => d.date > today)
  return `${item.date === today ? 'Today' : `Out ${monthDay(item.date)}`}${next ? ` · ${next.release_type} ${monthDay(next.date)}` : ''}`
}

/** A day of the agenda with its entries, or a stretch of days with nothing, said in one line. */
export type Segment = { type: 'day'; key: string; from: string; to: string; week: string; items: UpcomingItem[] } | { type: 'quiet'; key: string; from: string; to: string; week: string; text: string }

const wd = (day: string, month: boolean) => `${weekdayShort(day)} ${Number(day.slice(8))}${month ? ` ${utc(day, { month: 'short' })}` : ''}`

/** "Tue 3, Fri 6 – Sun 8": the runs of days a quiet line names. A run across a month, or a long one, names its months. */
function quietText(runs: readonly (readonly [string, string])[]): string {
  const text = runs.map(([a, b]) => {
    if (a === b) return wd(a, false)
    const month = a.slice(0, 7) !== b.slice(0, 7) || daysFrom(a, b) > 6
    return `${wd(a, month)} – ${wd(b, month)}`
  })
  return `Nothing on ${text.join(', ')}`
}

/**
 * The agenda as it is drawn, week by week (Monday to Sunday): a segment per day with entries, then one quiet line
 * for the week's other days (as runs). Weeks with no entries merge into one quiet line, except the week of today. It
 * reaches from the earlier of today and the first entry to the later of today and the last one.
 */
export function buildSegments(items: readonly UpcomingItem[], today: string): Segment[] {
  const byDay = new Map<string, UpcomingItem[]>()
  for (const item of items) {
    const day = localDay(item)
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }
  const days = [...byDay.keys(), today].sort()
  const out: Segment[] = []
  const thisWeek = weekStart(today)
  let merging = false
  for (let monday = weekStart(days[0]); monday <= days[days.length - 1]; monday = addDays(monday, 7)) {
    const week = weekDays(monday)
    const empty = week.every((d) => !byDay.has(d))
    if (empty && monday !== thisWeek) {
      const last = out.at(-1)
      if (merging && last?.type === 'quiet') {
        const runs: [string, string][] = [[last.from, addDays(monday, 6)]]
        out[out.length - 1] = { ...last, to: addDays(monday, 6), text: quietText(runs) }
      } else {
        out.push({ type: 'quiet', key: `quiet-${monday}`, from: monday, to: addDays(monday, 6), week: monday, text: quietText([[monday, addDays(monday, 6)]]) })
      }
      merging = true
      continue
    }
    merging = false
    const runs: [string, string][] = []
    for (const d of week) {
      const here = byDay.get(d)
      if (here) {
        out.push({ type: 'day', key: `day-${d}`, from: d, to: d, week: monday, items: here })
      } else if (runs.length > 0 && runs[runs.length - 1][1] === addDays(d, -1)) {
        runs[runs.length - 1][1] = d
      } else {
        runs.push([d, d])
      }
    }
    if (runs.length > 0) out.push({ type: 'quiet', key: `quiet-${monday}`, from: runs[0][0], to: runs[runs.length - 1][1], week: monday, text: quietText(runs) })
  }
  return out
}

/** A row the j/k selection can land on; `day` is the day it sits under ("" for a Title with no date). */
export type NavRow = { key: string; type: 'entry' | 'undated'; titleId: number; day: string }

/** The rows of the agenda in order, then the undated Titles. */
export function navRows(items: readonly UpcomingItem[], undated: UndatedItem[]): NavRow[] {
  const rows: NavRow[] = items.map((item) => ({ key: upcomingKey(item), type: 'entry', titleId: item.title_id, day: localDay(item) }))
  for (const u of undated) rows.push({ key: undatedKey(u), type: 'undated', titleId: u.title_id, day: '' })
  return rows
}

export const undatedKey = (u: UndatedItem) => `undated-${u.kind}-${u.title_id}`

/** The side panel's Views: all the entries, and the ones in a state of interest. */
export const views = [
  { key: 'all', label: 'Everything' },
  { key: 'wanted', label: 'Wanted when out' },
  { key: 'recent', label: 'Recently out' },
  { key: 'unmonitored', label: 'Not monitored' },
] as const
export type ViewKey = (typeof views)[number]['key']

/**
 * Whether an entry belongs to a view. Wanted when out is a monitored entry still to come with a Version that waits for its
 * release; Recently out is what came out in the last 14 days; Not monitored is what is not monitored.
 */
export function inView(view: ViewKey, today: string, item: UpcomingItem): boolean {
  const day = localDay(item)
  switch (view) {
    case 'all':
      return true
    case 'wanted':
      return item.monitored !== false && day >= today && item.slots.some((s) => s.state === 'not_out')
    case 'recent':
      return item.monitored !== false && (day < today ? day >= addDays(today, -14) : day === today)
    case 'unmonitored':
      return item.monitored === false
  }
}

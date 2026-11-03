// The logic behind the Upcoming agenda and the Overview's Coming section: where an entry stands
// (a Grab in flight overrides what the server says), the week the agenda shows, day labels and the views.
import type { QueueItem } from '../api/queue'
import { localDay, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'
import { percent } from '../format'
import { phases } from '../grabs/phase'
import { stateName, type SlotDotState } from '../ui/slotState'
import type { ChipData } from '../library/SlotChip'
import type { SlotNames } from '../library/slots'

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

/**
 * The first day of the week a day is in. Weeks roll: This week starts today and runs seven days (Nov 1 – 7 when today is
 * Nov 1), Next week follows it and Last week is the seven days before today.
 */
export const weekStart = (day: string, today: string) => addDays(today, Math.floor(daysFrom(today, day) / 7) * 7)

/** The seven days of the week that starts on `first`. */
export const weekDays = (first: string) => Array.from({ length: 7 }, (_, i) => addDays(first, i))

const utc = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })

/** "Oct 11" for a YYYY-MM-DD day. */
const monthDay = (day: string) => utc(day, { month: 'short', day: 'numeric' })

/** "Nov 1 – 7", or "Oct 29 – Nov 4" across months: the dates of the week that starts on `first`. */
export function weekRange(first: string): string {
  const end = addDays(first, 6)
  return `${monthDay(first)} – ${first.slice(5, 7) === end.slice(5, 7) ? Number(end.slice(8)) : monthDay(end)}`
}

/** What the agenda's header calls a week: This week, Next week, Last week, else "Week of Nov 9". */
export function weekTitle(today: string, first: string): string {
  const by = daysFrom(today, first) / 7
  if (by === 0) return 'This week'
  if (by === 1) return 'Next week'
  if (by === -1) return 'Last week'
  return `Week of ${monthDay(first)}`
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
  /** Whether a Wanted Version has been so long enough to be Long Missing: the dot is red then, else amber. */
  long: boolean
}

/**
 * The entry's status. A Grab in flight comes first, then a Version that is out and not found, then one that waits for its
 * release (Kestrel searches the moment it is out), then Imported; an entry that is not monitored and has no file in every
 * Version is Not monitored whatever the server says of its Versions.
 */
function entryStatus(item: UpcomingItem, queue: readonly QueueItem[]): EntryStatus {
  const all = item.slots.map((slot) => ({ slot, st: standing(item, slot, queue) }))
  const wanted = all.filter((x) => x.st.kind === 'wanted').map((x) => x.slot)
  const grabbed = all.find((x) => x.st.kind === 'grabbed')
  const imported = all.length > 0 && all.every((x) => x.st.kind === 'imported')
  if (!imported && item.monitored === false) return { kind: 'unmonitored', label: 'Not monitored', wanted: [], long: false }
  if (grabbed && grabbed.st.kind === 'grabbed') {
    const g = grabbed.st.grab
    const pct = g.phase === 'importing' ? null : percent(g.bytes_total, g.bytes_left)
    return { kind: 'downloading', label: g.phase === 'downloading' && pct !== null ? `Downloading · ${pct}%` : phases[g.phase].label, wanted, long: false }
  }
  if (wanted.length > 0) return { kind: 'missing', label: 'Out · not found yet', wanted, long: wanted.some((s) => s.long_missing) }
  if (imported) return { kind: 'imported', label: 'Imported', wanted, long: false }
  return { kind: 'searching', label: 'Not out yet', wanted, long: false }
}

/**
 * entryStatus that is worked out once per entry for one queue snapshot: ask it again, for a row, the week's numbers or the month's
 * count, and the answer is the one made first. Make a new one when the queue changes.
 */
export function statusCache(queue: readonly QueueItem[]): (item: UpcomingItem) => EntryStatus {
  const made = new WeakMap<UpcomingItem, EntryStatus>()
  return (item) => {
    let s = made.get(item)
    if (!s) made.set(item, (s = entryStatus(item, queue)))
    return s
  }
}

/** A Version's standing as the shared Slot dot draws it: Have, Downloading (with its percent), Wanted or Long Missing, Not out yet; Not monitored when the entry is off and has no file. */
function standingDot(st: Standing, entryMonitored: boolean | undefined): { state: SlotDotState; text?: string } {
  switch (st.kind) {
    case 'imported':
      return { state: 'filled' }
    case 'grabbed': {
      const pct = st.grab.phase === 'downloading' ? percent(st.grab.bytes_total, st.grab.bytes_left) : null
      return { state: 'downloading', text: pct !== null ? `${pct}%` : undefined }
    }
    case 'wanted':
      return entryMonitored === false ? { state: 'unmonitored' } : { state: st.long ? 'long_missing' : 'wanted' }
    default:
      return { state: entryMonitored === false ? 'unmonitored' : 'unreleased' }
  }
}

/** An entry's Slots as chips, one per Version, each in the state it stands in: "STD", "4K 40%". */
export function entryChips(item: Pick<UpcomingItem, 'kind' | 'title_id' | 'season' | 'episode' | 'slots' | 'monitored'>, queue: readonly QueueItem[], names: SlotNames): ChipData[] {
  return item.slots.map((slot) => {
    const d = standingDot(standing(item, slot, queue), item.monitored)
    return { key: slot.slot, short: names.several ? names.short(slot.slot) : '', state: d.state, text: d.text, tip: `${names.name(slot.slot)}: ${stateName[d.state]}${d.text ? ` ${d.text}` : ''}` }
  })
}

/** What a week adds up to: the episodes airing, the Movie releases, and how many entries wait for their release or are in the Library. */
export type WeekStats = { episodes: number; movies: number; searching: number; imported: number }

export function weekStats(items: readonly UpcomingItem[], first: string, statusOf: (item: UpcomingItem) => EntryStatus): WeekStats {
  const end = addDays(first, 6)
  const out: WeekStats = { episodes: 0, movies: 0, searching: 0, imported: 0 }
  for (const item of items) {
    const day = localDay(item)
    if (day < first || day > end) continue
    if (item.kind === 'series') out.episodes++
    else out.movies++
    const { kind } = statusOf(item)
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
 * The agenda as it is drawn, week by week (the weeks roll from today, see weekStart): a segment per day with entries, then one quiet line
 * for the week's other days (as runs). Weeks with no entries merge into one quiet line, except the week of today. It
 * reaches from the earlier of today and the first entry to the later of today and the last one.
 */
export function buildSegments(items: readonly UpcomingItem[], today: string): Segment[] {
  const byDay = new Map<string, UpcomingItem[]>()
  for (const item of items) {
    const day = localDay(item)
    const here = byDay.get(day)
    if (here) here.push(item)
    else byDay.set(day, [item])
  }
  const days = [...byDay.keys(), today].sort()
  const out: Segment[] = []
  const thisWeek = today
  let merging = false
  for (let first = weekStart(days[0], today); first <= days[days.length - 1]; first = addDays(first, 7)) {
    const week = weekDays(first)
    const empty = week.every((d) => !byDay.has(d))
    if (empty && first !== thisWeek) {
      const last = out.at(-1)
      if (merging && last?.type === 'quiet') {
        const runs: [string, string][] = [[last.from, addDays(first, 6)]]
        out[out.length - 1] = { ...last, to: addDays(first, 6), text: quietText(runs) }
      } else {
        out.push({ type: 'quiet', key: `quiet-${first}`, from: first, to: addDays(first, 6), week: first, text: quietText([[first, addDays(first, 6)]]) })
      }
      merging = true
      continue
    }
    merging = false
    const runs: [string, string][] = []
    for (const d of week) {
      const here = byDay.get(d)
      if (here) {
        out.push({ type: 'day', key: `day-${d}`, from: d, to: d, week: first, items: here })
      } else if (runs.length > 0 && runs[runs.length - 1][1] === addDays(d, -1)) {
        runs[runs.length - 1][1] = d
      } else {
        runs.push([d, d])
      }
    }
    if (runs.length > 0) out.push({ type: 'quiet', key: `quiet-${first}`, from: runs[0][0], to: runs[runs.length - 1][1], week: first, text: quietText(runs) })
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

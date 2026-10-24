// The logic behind the Upcoming timeline and the Overview's Coming section: where an entry stands
// (a Grab in flight overrides what the server says), grouping, day labels and the filters.
import type { QueueItem } from '../api/queue'
import { localDay, type UndatedItem, type UpcomingItem, type UpcomingSlot } from '../api/upcoming'

export type Filters = { kind: 'all' | 'movie' | 'series'; wantedOnly: boolean; hideImported: boolean }
export const noFilters: Filters = { kind: 'all', wantedOnly: false, hideImported: false }

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

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
const dated = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Sat 18 Oct" for a YYYY-MM-DD day. */
export const dayLabel = dated

/** Yesterday, Today, Tomorrow, the weekday within the week either side, then the date. */
export function relativeDay(today: string, day: string): string {
  const d = daysFrom(today, day)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return 'Yesterday'
  return Math.abs(d) <= 6 ? weekday(day) : dated(day)
}

/** The week a day falls in, against today's: what the separators between days are called. */
export function weekOf(today: string, day: string): 'Earlier' | 'Last week' | 'This week' | 'Next week' | 'Later' {
  const sinceMonday = (dayNumber(today) + 3) % 7 // 1970-01-01 was a Thursday: 0 is Monday
  const d = daysFrom(today, day) + sinceMonday // days from this week's Monday
  if (d < -7) return 'Earlier'
  if (d < 0) return 'Last week'
  if (d < 7) return 'This week'
  if (d < 14) return 'Next week'
  return 'Later'
}

/** Whether an entry passes the filters. Titles with nothing to do in a Slot count as filled only when every Slot is Imported. */
export function passes(item: { kind: UpcomingItem['kind']; slots: UpcomingSlot[] }, f: Filters): boolean {
  if (f.kind !== 'all' && item.kind !== f.kind) return false
  if (f.wantedOnly && !item.slots.some((s) => s.state === 'wanted')) return false
  if (f.hideImported && item.slots.length > 0 && item.slots.every((s) => s.state === 'imported')) return false
  return true
}

/** One thing on the timeline: an entry, or several episodes of one Series on one day. */
export type Block = { type: 'entry'; key: string; item: UpcomingItem } | { type: 'group'; key: string; items: UpcomingItem[] }

export type Day = { day: string; blocks: Block[] }

/** The entries by day; episodes of one Series on one day collapse into a group once there are two. */
export function buildDays(items: UpcomingItem[]): Day[] {
  const days: Day[] = []
  for (const item of items) {
    let day = days.at(-1)
    const on = localDay(item)
    if (day?.day !== on) days.push((day = { day: on, blocks: [] }))
    const last = day.blocks.at(-1)
    const lastItem = last?.type === 'entry' ? last.item : last?.items[0]
    if (item.kind === 'series' && last && lastItem?.kind === 'series' && lastItem.title_id === item.title_id) {
      if (last.type === 'entry') day.blocks[day.blocks.length - 1] = { type: 'group', key: `group-${on}-${item.title_id}`, items: [last.item, item] }
      else last.items.push(item)
    } else {
      day.blocks.push({ type: 'entry', key: upcomingKey(item), item })
    }
  }
  return days
}

/** "S02E01–E08", or "S01E10–S02E01" across seasons. */
export function episodeRange(items: UpcomingItem[]): string {
  const first = items[0]
  const last = items[items.length - 1]
  if (first.season === last.season) return `${episodeCode(first.season!, first.episode!)}–E${String(last.episode).padStart(2, '0')}`
  return `${episodeCode(first.season!, first.episode!)}–${episodeCode(last.season!, last.episode!)}`
}

/** A row the j/k selection can land on; `day` is the day it sits under ("" for a Title with no date). */
export type NavRow = { key: string; type: 'entry' | 'group' | 'child' | 'undated'; titleId: number; day: string }

/** The rows of the timeline in order, a group's episodes after it while it is open, then the undated Titles. */
export function navRows(days: Day[], undated: UndatedItem[], open: ReadonlySet<string>): NavRow[] {
  const rows: NavRow[] = []
  for (const { day, blocks } of days) {
    for (const b of blocks) {
      if (b.type === 'entry') {
        rows.push({ key: b.key, type: 'entry', titleId: b.item.title_id, day })
        continue
      }
      rows.push({ key: b.key, type: 'group', titleId: b.items[0].title_id, day })
      if (open.has(b.key)) for (const item of b.items) rows.push({ key: upcomingKey(item), type: 'child', titleId: item.title_id, day })
    }
  }
  for (const u of undated) rows.push({ key: undatedKey(u), type: 'undated', titleId: u.title_id, day: '' })
  return rows
}

export const undatedKey = (u: UndatedItem) => `undated-${u.kind}-${u.title_id}`

/** What a group's episodes add up to, per Slot: how many are Imported, downloading, Wanted (some Long Missing) or not out. */
export type Tally = { slot: UpcomingSlot['slot']; imported: number; grabbed: number; wanted: number; long: number; notOut: number; since: string | null }

export function tally(items: UpcomingItem[], queue: readonly QueueItem[]): Tally[] {
  const out = new Map<string, Tally>()
  for (const item of items) {
    for (const slot of item.slots) {
      const t = out.get(slot.slot) ?? { slot: slot.slot, imported: 0, grabbed: 0, wanted: 0, long: 0, notOut: 0, since: null }
      out.set(slot.slot, t)
      const s = standing(item, slot, queue)
      if (s.kind === 'imported') t.imported++
      else if (s.kind === 'grabbed') t.grabbed++
      else if (s.kind === 'not_out') t.notOut++
      else {
        t.wanted++
        if (s.long) t.long++
        if (s.since && (t.since === null || Date.parse(s.since) < Date.parse(t.since))) t.since = s.since
      }
    }
  }
  return [...out.values()]
}

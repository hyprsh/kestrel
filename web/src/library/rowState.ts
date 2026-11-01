// What a Library row says about its Title besides its name: one line on why it is in its state
// ("Long Missing · Wanted for 96 days", "S02: 2 Wanted, 1 downloading"), toned by that state, the
// Slot dots with the Grabs on their way counted in, and the poster badge of the grid. It reads the
// row (GET /titles) and the Title's Grabs in the queue (GET /queue, kept live by the stream), so a
// download's progress moves without the Library being fetched again.
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { ago, clockTime, span } from '../time'
import { expandCodes } from './cellDetail'
import { size as bytes, slotLabel, type SlotKey } from './bits'

export type Tone = 'error' | 'warning' | 'info' | 'quiet'

/** The text class of each tone. */
export const toneText: Record<Tone, string> = { error: 'text-red-900', warning: 'text-amber-900', info: 'text-accent-900', quiet: 'text-gray-900' }

const DAY = 24 * 60 * 60 * 1000

/** "12 days", or "5 h" under a day. */
function days(ms: number): string {
  const n = Math.floor(ms / DAY)
  return n < 1 ? span(ms) : `${n} ${n === 1 ? 'day' : 'days'}`
}

/** "last searched 14:02" today, "last searched 3 d 4 h ago" before, "not searched yet" when never. */
function searched(iso: string | null, now: number): string {
  if (!iso) return 'not searched yet'
  return now - Date.parse(iso) < 12 * 60 * 60 * 1000 ? `last searched ${clockTime(iso)}` : `last searched ${ago(iso, now)}`
}

/** "S02" */
const season = (n: number) => `S${String(n).padStart(2, '0')}`

/** The seasons Wanted episodes are in: "S02", "S01, S03" or, past three, "4 seasons". */
function seasons(ns: number[]): string {
  return ns.length > 3 ? `${ns.length} seasons` : ns.map(season).join(', ')
}

/** A Grab's progress in a word or two: "64% · 6 min left", "queued", "paused". */
function progress(g: QueueItem): string {
  if (g.stuck) return 'taking longer than usual'
  switch (g.phase) {
    case 'downloading': {
      const pct = percent(g.bytes_total, g.bytes_left)
      return [pct === null ? null : `${pct}%`, g.eta ? `${span(g.eta * 1000)} left` : null].filter(Boolean).join(' · ') || 'starting'
    }
    case 'queued':
      return 'queued'
    case 'paused':
      return 'paused'
    case 'post_processing':
      return 'unpacking'
    case 'importing':
      return 'importing'
  }
  return g.phase
}

/** The episodes a Series Grab covers, short: "S03E07", or "S03E01–S03E10" for several. */
function episodes(g: QueueItem): string {
  const e = g.episodes
  return e.length <= 1 ? (e[0] ?? 'Episodes') : `${e[0]}–${e[e.length - 1]}`
}

/** The Title's Versions with their Slots, in Slot order. */
const kept = (r: TitleRow) => r.slot_states.map((v) => ({ slot: v.slot as SlotKey, v }))

/** Whether a Grab fills a Version that has nothing yet (or a misfit), rather than Upgrading a file. */
const filling = (g: QueueItem) => !g.is_upgrade

export type StateLine = { text: string; tone: Tone }

/**
 * Why the Title is where it is, in one line. In order: a Series' Wanted episodes (with the downloading ones), a Grab
 * on its way, Long Missing, Wanted (with when Kestrel last looked), not out yet, not monitored, and else what it holds.
 */
export function stateLine(r: TitleRow, grabs: readonly QueueItem[], now: number, opts: { size?: boolean } = {}): StateLine {
  const vs = kept(r)
  const two = vs.length > 1
  const w = r.wanted_episodes
  if (r.kind === 'series' && w && w.wanted > 0) {
    // A season pack that also holds filled episodes counts as an Upgrade, so any Grab counts here; the Wanted ones are all that can be downloading.
    const downloading = Math.min(w.wanted, new Set(grabs.flatMap((g) => expandCodes(g.episodes))).size)
    const text = `${seasons(w.seasons)}: ${w.wanted} Wanted${downloading > 0 ? `, ${downloading} downloading` : ''}`
    return w.long_missing > 0 ? { text: `Long Missing · ${text}`, tone: 'error' } : { text, tone: 'warning' }
  }
  const [g] = grabs
  if (g) {
    const verb = g.is_upgrade ? 'upgrading' : 'downloading'
    const what = r.kind === 'series' ? episodes(g) : two && g.slot ? slotLabel[g.slot] : null
    const lead = what ? `${what} ${verb}` : verb[0].toUpperCase() + verb.slice(1)
    return { text: `${lead} · ${progress(g)}`, tone: 'info' }
  }
  if (!r.monitored) return { text: 'Not monitored', tone: 'quiet' }
  const long = vs.filter((x) => x.v.long_missing)
  const wanted = vs.filter((x) => x.v.state === 'wanted')
  // A Slot is named when only some of the Title's Versions are in the state.
  const which = (some: typeof vs) => (two && some.length < vs.length ? `${slotLabel[some[0].slot]} ` : '')
  if (long.length > 0) return { text: `Long Missing · ${which(long)}Wanted for ${days(now - Date.parse(r.wanted_since ?? r.added_at))}`, tone: 'error' }
  if (wanted.length > 0) {
    const since = r.wanted_since ? `Wanted for ${days(now - Date.parse(r.wanted_since))}` : 'Wanted'
    return { text: `${which(wanted)}${since} · ${searched(r.searched_at, now)}`, tone: 'warning' }
  }
  if (vs.length > 0 && vs.every((x) => x.v.state === 'unmonitored')) return { text: 'Not monitored', tone: 'quiet' }
  if (vs.some((x) => x.v.state === 'unreleased') && !vs.some((x) => x.v.state === 'filled')) return { text: 'Not out yet', tone: 'quiet' }
  return { text: holding(r, vs, now, opts.size ?? false), tone: 'quiet' }
}

/**
 * What a Title that wants nothing holds: its Primary-Language title when it differs, its filled Slots (named when it
 * keeps two), its size, and when it was added if lately; "Filled" when none of that says anything.
 */
function holding(r: TitleRow, vs: ReturnType<typeof kept>, now: number, withSize: boolean): string {
  const filled = vs.filter((x) => x.v.state === 'filled').map((x) => slotLabel[x.slot])
  const slots = vs.length > 1 && filled.length > 0 ? (filled.length === vs.length ? filled.join(' & ') : `${filled.join(' & ')} filled`) : null
  const added = now - Date.parse(r.added_at) < 7 * DAY ? `added ${ago(r.added_at, now)}` : null
  const parts = [r.primary_title !== r.title ? r.primary_title : null, slots, withSize && r.size > 0 ? bytes(r.size) : null, added]
  const text = parts.filter(Boolean).join(' · ')
  return text ? text[0].toUpperCase() + text.slice(1) : 'Filled'
}

/** Whether a Title is monitored, as GET /titles says: a Movie's flag, a Series' mode not being Not monitored. */
export const isMonitoredRow = (r: TitleRow) => r.monitored

/** The Slots as the chips show them, in Slot order: a Wanted Version a Grab is filling is downloading. */
export function shownSlots(r: TitleRow, grabs: readonly QueueItem[]): TitleRow['slot_states'] {
  return r.slot_states.map((v) => (v.state === 'wanted' && grabs.some((g) => g.slot === v.slot && filling(g)) ? { ...v, state: 'downloading' } : v))
}

/** The grid's poster badge: Long Missing, or how far a Grab has got. */
export function posterBadge(r: TitleRow, grabs: readonly QueueItem[]): { label: string; tone: 'error' | 'info' } | null {
  const [g] = grabs
  if (g) {
    const pct = g.phase === 'downloading' ? percent(g.bytes_total, g.bytes_left) : null
    return { label: pct === null ? progress(g)[0].toUpperCase() + progress(g).slice(1) : `${pct}%`, tone: 'info' }
  }
  if (kept(r).some((x) => x.v.long_missing)) return { label: 'Long Missing', tone: 'error' }
  return null
}

/** The queue's Grabs by Title, for the rows to look up. */
export function grabsByTitle(queue: readonly QueueItem[] | undefined): Map<number, QueueItem[]> {
  const out = new Map<number, QueueItem[]>()
  for (const g of queue ?? []) {
    if (g.title_id === null) continue
    out.set(g.title_id, [...(out.get(g.title_id) ?? []), g])
  }
  return out
}

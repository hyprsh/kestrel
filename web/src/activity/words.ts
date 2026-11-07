// The words Activity's rows share: what a Grab covers, why one failed, and how a day is named.
import type { GrabEntry } from '../api/activity'
import type { QueueItem } from '../api/queue'
import { size } from '../library/bits'
import { reasonWords, rejectionText } from '../rejection'
import { speedText } from '../overview/statsText'
import { span } from '../time'

/** Why a failed Grab failed, in words; an Import's own reasons (`language`, …) are in rejection.ts. */
export const failureText: Record<string, string> = {
  download_failed: 'the download failed',
  encrypted: 'the download is encrypted',
  lost: 'the download client lost the job',
  discarded: 'its stalled Import was discarded',
}

/** What a Grab covers beside its Title: "S05E07 – E08"; empty for a Movie (its Slot is the row's chip). */
export function whatOf(g: { episodes: readonly string[] }): string {
  return g.episodes.join(', ').replace('-', ' – ')
}

/** The short reason for the Result column: the download client's own words, the words of a known failure, or what the Import rejected. */
export const shortWhy = (g: Pick<GrabEntry, 'failure' | 'failure_message'>) => g.failure_message ?? (g.failure ? (failureText[g.failure] ?? rejectionText(g.failure)) : 'it failed')

/** The full reason a Grab failed: the short one and its Blocklist note, which would only repeat the client's own words. */
export function whyFailed(g: Pick<GrabEntry, 'failure' | 'failure_message' | 'blocklist_reason'>): string {
  const base = shortWhy(g)
  if (!g.blocklist_reason) return base
  return g.failure_message ? `${base} (Blocklisted)` : `${base} (Blocklisted: ${reasonWords(g.blocklist_reason)})`
}

/** The download speed: what the client reports, else the one its ETA implies, or null when it has said neither. */
export function speed(i: QueueItem): string | null {
  if (i.phase !== 'downloading') return null
  if (i.bytes_per_second) return speedText(i.bytes_per_second)
  if (!i.eta || i.bytes_left <= 0) return null
  return `${size(i.bytes_left / i.eta)}/s`
}

/** Why a Stuck download is stuck, in words. Not a Stalled Import: that is its own stage. */
export function stuckText(s: NonNullable<QueueItem['stuck']>, now: number): string {
  return s.reason === 'paused' ? 'Stuck: paused in the download client' : `Stuck: no progress for ${span(now - Date.parse(s.since))}`
}

/** "Today", "Yesterday", or "Oct 29" (with the year when it is not this one). */
export function dayName(at: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const diff = Math.round((day(now) - day(at)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "09:15": the time of day on a 24-hour clock, as the History table and the steps tell it. */
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

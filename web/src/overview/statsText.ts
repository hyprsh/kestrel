// The words and numbers of the Overview's dashboard: sizes, speeds, durations, the range's name and the
// one-line "what stands out" under the Grabs chart. Pure, so the tests read them without a screen.
import { plural } from '../format'
import { span } from '../time'
import type { Stats, StatsRange } from '../api/stats'

export const ranges: { value: StatsRange; label: string; days: number; short: string }[] = [
  { value: '7d', label: 'Last 7 days', days: 7, short: '7 d' },
  { value: '30d', label: 'Last 30 days', days: 30, short: '30 d' },
  { value: '90d', label: 'Last 90 days', days: 90, short: '90 d' },
]

export const rangeOf = (r: StatsRange) => ranges.find((x) => x.value === r) ?? ranges[1]

/** "440 GB", "1.2 TB": 1024-based like the Library's sizes (library/bits `size`), labelled GB and TB; one decimal under 10. */
export function bytesText(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  const digits = v < 10 && u > 0 ? 1 : 0
  return `${v.toFixed(digits).replace(/\.0$/, '')} ${units[u]}`
}

/** "24 MB/s": a link speed, so decimal (a million bytes to the MB), a decimal under ten. */
export function speedText(bytesPerSecond: number): string {
  const mb = bytesPerSecond / 1e6
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB/s`
  if (mb >= 1) return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB/s`
  return `${Math.round(bytesPerSecond / 1e3)} kB/s`
}

/** "2 h 14 min" for a count of seconds. */
export const durationText = (seconds: number) => span(seconds * 1000)

/** "full in ~9 months", "full in ~2.5 years"; nothing without an estimate. */
export function fullInText(months: number | null): string | null {
  if (months === null) return null
  if (months < 1) return 'full in under a month'
  if (months < 24) return `full in ~${plural(Math.round(months), 'month')}`
  const years = Math.round((months / 12) * 10) / 10
  return `full in ~${plural(years, 'year')}`
}

/** "38 min faster" / "5 min slower", or "about the same" inside a minute. Null without both medians. */
export function fillDelta(median: number | null, previous: number | null): { text: string; faster: boolean } | null {
  if (median === null || previous === null) return null
  const diff = previous - median
  if (Math.abs(diff) < 60) return { text: 'about the same', faster: false }
  return { text: `${span(Math.abs(diff) * 1000)} ${diff > 0 ? 'faster' : 'slower'}`, faster: diff > 0 }
}

/** "Oct 18". The day is a calendar date, so it is read as one: no time zone moves it. */
export function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** How many Grabs finished: imported and failed. */
export const grabsTotal = (s: Stats) => s.grabs.imported + s.grabs.failed

/**
 * The sentence under the Grabs chart: the busiest day, and the indexer with the most failed Grabs. Each half is left
 * out when the data is too thin to say it: a busiest day needs at least 5 Grabs in the range and 3 on that day; an
 * indexer is named only when it has at least 2 failures and more than any other. Null when neither is worth saying.
 */
export function standOut(s: Stats): string | null {
  const parts: string[] = []
  if (grabsTotal(s) >= 5) {
    const busiest = s.grabs.per_day.reduce((a, b) => (b.imported + b.failed > a.imported + a.failed ? b : a), s.grabs.per_day[0])
    const n = busiest ? busiest.imported + busiest.failed : 0
    if (n >= 3) parts.push(`Busiest: ${dayText(busiest.day)}, ${plural(n, 'Grab')}.`)
  }
  const failing = [...s.indexers].sort((a, b) => b.failed - a.failed)
  if (failing[0] && failing[0].failed >= 2 && failing[0].failed > (failing[1]?.failed ?? 0)) parts.push(`Failures cluster on ${failing[0].name}.`)
  return parts.length ? parts.join(' ') : null
}

/** What one chart column spans: the Grabs chart has a column per day for 7 days and per week for 30 and 90. */
export const periodWord = (r: StatsRange) => (r === '7d' ? 'day' : 'week')

/** "Oct 18" for a day, "Oct 12 – Oct 18" for a week. */
export const periodText = (from: string, to: string) => (from === to ? dayText(from) : `${dayText(from)} – ${dayText(to)}`)

/** "Grabs per week over the last 30 days: 62 imported, 6 failed; busiest day Oct 18 with 8 Grabs." */
export function grabsAlternative(s: Stats): string {
  const base = `Grabs per ${periodWord(s.range)} over the last ${rangeOf(s.range).days} days: ${s.grabs.imported} imported, ${s.grabs.failed} failed`
  const busiest = s.grabs.per_day.reduce((a, b) => (b.imported + b.failed > a.imported + a.failed ? b : a), s.grabs.per_day[0])
  const n = busiest ? busiest.imported + busiest.failed : 0
  return n > 0 ? `${base}; busiest day ${dayText(busiest.day)} with ${plural(n, 'Grab')}.` : `${base}.`
}

/** "Hit" as a percentage, "—" when no search was answered. */
export const hitText = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

/** "0.6 s", "2.4 s", "<0.1 s" for an answer in under a tenth of a second; "—" without an answer. */
export function answerText(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 100 ? '<0.1 s' : `${(ms / 1000).toFixed(1)} s`
}

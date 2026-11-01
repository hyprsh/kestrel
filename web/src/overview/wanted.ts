// The Wanted Versions the Overview's Searching card lists: one per Wanted Slot of a Title, Long Missing first, then the
// ones Wanted longest. Read from the Library rows (`GET /titles`), which the live stream keeps current.
import type { TitleRow } from '../api/queries'
import type { components } from '../api/schema.gen'
import { plural } from '../format'
import { slotKeys, slotLabel, type SlotKey } from '../library/bits'
import { foundText } from '../library/WantedLine'
import { until } from '../time'

type LastSearch = components['schemas']['LastSearch']

export type WantedItem = {
  versionId: number
  titleId: number
  title: string
  hasPoster: boolean
  slot: SlotKey
  /** A Series' Wanted episodes, null for a Movie. */
  episodes: number | null
  longMissing: boolean
  /** When the Title first became Wanted (ISO), null when the row does not say. */
  since: string | null
  /** What the Version's last search found, and when it is searched next. */
  lastSearch: LastSearch | null
  nextSearchAt: string | null
}

/** Every Wanted Version of the rows, Long Missing first, then the longest Wanted; the same Title's Slots keep Standard first. */
export function wantedVersions(rows: TitleRow[]): WantedItem[] {
  const items = rows.flatMap((r) =>
    slotKeys.flatMap((slot) => {
      const s = r.slots[slot]
      if (!s || s.state !== 'wanted') return []
      return [
        {
          versionId: s.version_id,
          titleId: r.id,
          title: r.title,
          hasPoster: r.has_poster,
          slot,
          episodes: r.kind === 'series' ? (r.wanted_episodes?.wanted ?? null) : null,
          longMissing: s.long_missing,
          since: r.wanted_since,
          lastSearch: s.last_search ?? null,
          nextSearchAt: s.next_search_at ?? null,
        },
      ]
    }),
  )
  const t = (i: WantedItem) => (i.since ? Date.parse(i.since) : Infinity)
  return items.sort((a, b) => Number(b.longMissing) - Number(a.longMissing) || t(a) - t(b))
}

/** "4K", or "4K · 3 episodes" for a Series. */
export const wantedWhat = (i: WantedItem) => [slotLabel[i.slot], i.episodes ? plural(i.episodes, 'episode') : null].filter(Boolean).join(' · ')

/**
 * "Long Missing · 100 days · 23 releases, all German only", "Wanted 3 days · nothing found yet", "Wanted 2 days · next search in
 * 54 min": the age, then what the last search found, or when the next one is when it found nothing to report.
 */
export function wantedWhy(i: WantedItem, now: number): string {
  const days = i.since ? Math.max(0, Math.floor((now - Date.parse(i.since)) / 86_400_000)) : null
  const age = days === null ? null : days === 0 ? 'today' : plural(days, 'day')
  const head = i.longMissing ? ['Long Missing', age].filter(Boolean).join(' · ') : age ? `Wanted ${age}` : 'Wanted'
  const fact = i.lastSearch ? foundText(i.lastSearch) : i.nextSearchAt ? `next search ${until(i.nextSearchAt, now)}` : null
  return fact ? `${head} · ${fact}` : head
}

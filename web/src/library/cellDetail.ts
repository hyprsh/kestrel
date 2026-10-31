// What an episode's Slot cell says beside its dot, on one line: the file's quality and size, how long ago a Wanted episode aired,
// a download's progress, or the air date of one not out yet. It only uses what the page already loads: the episode's cell and
// the queue's Grabs (GET /queue). The API gives no per-episode wanted-since, last search outcome, release group or codec.
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { size, type SlotKey } from './bits'
import { episodeCode } from './episodes'

/** The queue's Grabs by Slot and episode code ("standard S01E02"), for one Title. */
export function grabsByEpisode(queue: readonly QueueItem[] | undefined, titleId: number): Map<string, QueueItem> {
  const out = new Map<string, QueueItem>()
  for (const g of queue ?? []) {
    if (g.title_id !== titleId || !g.slot) continue
    for (const code of g.episodes) out.set(`${g.slot} ${code}`, g)
  }
  return out
}

export const grabOf = (grabs: Map<string, QueueItem>, slot: SlotKey, e: Episode) => grabs.get(`${slot} ${episodeCode(e)}`)

/** "13 min", "2 h": the time a download has left. */
function remaining(seconds: number): string {
  if (seconds < 60) return '<1 min'
  const min = Math.round(seconds / 60)
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`
}

const monthDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "3 d ago" for an air date in the past, from `now` (ms). */
function agoOf(iso: string, now: number): string | null {
  const d = Math.floor((now - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000)
  return d < 0 ? null : d === 0 ? 'today' : `${d} d ago`
}

/** The line of a Slot cell: null for a Slot with no Version (the cell shows "—"). `grab` is the Grab covering the episode, if any. */
export function cellText(cell: Episode['cells'][SlotKey], episode: Episode, grab: QueueItem | undefined, label: string, now = Date.now()): string | null {
  if (!cell) return null
  switch (cell.state) {
    case 'filled':
      return cell.file ? [cell.file.quality, size(cell.file.size)].filter(Boolean).join(' · ') : label
    case 'downloading': {
      if (!grab) return label
      if (grab.phase === 'importing' || grab.phase === 'post_processing') return 'Importing'
      if (grab.phase === 'queued') return 'Queued'
      if (grab.phase === 'paused') return 'Paused'
      const pct = grab.bytes_total > 0 ? Math.round(((grab.bytes_total - grab.bytes_left) / grab.bytes_total) * 100) : null
      return [pct === null ? 'Downloading' : `${pct} %`, grab.eta !== null ? remaining(grab.eta) : null].filter(Boolean).join(' · ')
    }
    case 'wanted': {
      const ago = episode.air_date ? agoOf(episode.air_date, now) : null
      return ago ? `Wanted · aired ${ago}` : label
    }
    case 'unreleased':
      return episode.air_date ? `Not out yet · ${monthDay(episode.air_date)}` : 'Not out yet'
    default:
      return label
  }
}

// What an episode's Slot cell says beside its dot, on one line: the file's resolution and size, how many days a Wanted episode has
// been out, a download's progress, or the air date of one not out yet. It only uses what the page already loads: the episode's cell and
// the queue's Grabs (GET /queue). The API gives no per-episode wanted-since, last search outcome, release group or codec.
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { size } from './bits'
import { episodeCode } from './episodes'

/** What a Slot cell needs of a Version's cell: an Episode's cell, or a Movie Version's state with its file. */
export type CellLike = { state: string; score?: number | null; file: { path: string; size: number; quality?: string | null } | null }

/** The episode codes a Grab's `episodes` name: the API gives "S05E09" for one and "S05E05-E10" for a run, which this spells out one by one. */
export function expandCodes(labels: readonly string[]): string[] {
  return labels.flatMap((label) => {
    const m = /^(S\d+)E(\d+)-E(\d+)$/.exec(label)
    if (!m) return [label]
    const width = m[2].length
    return Array.from({ length: Number(m[3]) - Number(m[2]) + 1 }, (_, i) => `${m[1]}E${String(Number(m[2]) + i).padStart(width, '0')}`)
  })
}

/** Episode codes as runs: "S05E05", "S05E06", "S05E07" and "S05E09" make "S05E05–E07, S05E09". Codes that are not an episode's stay as they are. */
export function codeRuns(codes: readonly string[]): string {
  const parsed = [...new Set(codes)].map((code) => ({ code, m: /^S(\d+)E(\d+)$/.exec(code) }))
  const eps = parsed.flatMap((p) => (p.m ? [{ season: p.m[1], number: Number(p.m[2]), width: p.m[2].length }] : [])).sort((a, b) => Number(a.season) - Number(b.season) || a.number - b.number)
  const other = parsed.filter((p) => !p.m).map((p) => p.code)
  const runs: { season: string; from: number; to: number; width: number }[] = []
  for (const e of eps) {
    const last = runs[runs.length - 1]
    if (last && last.season === e.season && last.to + 1 === e.number) last.to = e.number
    else runs.push({ season: e.season, from: e.number, to: e.number, width: e.width })
  }
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  const text = runs.map((r) => `S${r.season}E${pad(r.from, r.width)}${r.to > r.from ? `\u2013E${pad(r.to, r.width)}` : ''}`)
  return [...text, ...other].join(', ')
}

/** The queue's Grabs by Slot and episode code ("standard S01E02"), for one Title. */
export function grabsByEpisode(queue: readonly QueueItem[] | undefined, titleId: number): Map<string, QueueItem> {
  const out = new Map<string, QueueItem>()
  for (const g of queue ?? []) {
    if (g.title_id !== titleId || !g.slot) continue
    for (const code of expandCodes(g.episodes)) out.set(`${g.slot} ${code}`, g)
  }
  return out
}

export const grabOf = (grabs: Map<string, QueueItem>, slot: string, e: Episode) => grabs.get(`${slot} ${episodeCode(e)}`)

/** "13 min", "2 h": the time a download has left. */
function remaining(seconds: number): string {
  if (seconds < 60) return '<1 min'
  const min = Math.round(seconds / 60)
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`
}

export const monthDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "Mon, Nov 2": the weekday and the day of an air date. */
export const weekdayDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "Oct 19" for an air date this year, "Jan 20, 2008" for another year: the Aired column. */
export function airedText(iso: string, now = Date.now()): string {
  const year = new Date(`${iso}T00:00:00Z`).getUTCFullYear() === new Date(now).getUTCFullYear()
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', ...(year ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

/** "7 d" for an air date that many days back, from `now` (ms); "today" for the day itself, null for one still to come. */
function agoOf(iso: string, now: number): string | null {
  const d = Math.floor((now - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000)
  return d < 0 ? null : d === 0 ? 'today' : `${d} d`
}

/** "1080p" for a quality name such as "WEBDL-1080p": the resolution, which is what a short cell has room for. */
const resolutionOf = (quality: string) => quality.split('-').pop() ?? quality

/** The line of a Slot cell: null for a Slot with no Version (the cell shows "—"). `grab` is the Grab covering the episode, if any. */
export function cellText(cell: CellLike | null, episode: Pick<Episode, 'air_date'>, grab: QueueItem | undefined, label: string, now = Date.now()): string | null {
  if (!cell) return null
  switch (cell.state) {
    case 'filled':
      return cell.file ? [cell.file.quality ? resolutionOf(cell.file.quality) : null, size(cell.file.size)].filter(Boolean).join(' · ') : label
    case 'downloading': {
      if (!grab) return label
      if (grab.phase === 'importing' || grab.phase === 'post_processing') return 'Importing'
      if (grab.phase === 'queued') return 'Queued'
      if (grab.phase === 'paused') return 'Paused'
      const pct = grab.bytes_total > 0 ? Math.round(((grab.bytes_total - grab.bytes_left) / grab.bytes_total) * 100) : null
      return [pct === null ? 'Downloading' : `${pct}%`, grab.eta !== null ? remaining(grab.eta) : null].filter(Boolean).join(' · ')
    }
    case 'wanted': {
      const ago = episode.air_date ? agoOf(episode.air_date, now) : null
      return ago ? `Wanted · ${ago}` : label
    }
    case 'unreleased':
      return episode.air_date ? monthDay(episode.air_date) : 'Not aired'
    default:
      return label
  }
}

/** The name of a file on disk: the last part of its path. */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

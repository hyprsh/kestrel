// The Health checks as tiles: the download client, each indexer, each disk and the rest, grouped and
// failing first. Used by Activity's Health tab and its tab dot.
import type { SystemStatus } from '../../api/attention'
import { clockTime } from '../../time'
import type { TileData, Tone } from './HealthTile'

/** "800 GB", "1 TB": powers of 1024, no decimals once a number is round. */
function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${units[i]}`
}

function clientTile(s: SystemStatus['download_client']): TileData {
  if (s.state === 'none') return { key: 'client', name: 'Download client', tone: 'idle', word: 'not set up', details: ['No download client set up'] }
  return {
    key: 'client',
    name: s.name ?? 'Download client',
    instanceId: s.instance_id,
    tone: s.state === 'ok' ? 'ok' : 'failing',
    details: s.state === 'ok' ? [] : [s.message ?? 'Not answering'],
  }
}

type Indexer = SystemStatus['indexers'][number]

function indexerTile(i: Indexer): TileData {
  const searchPaused = i.search_paused_until != null
  const grabsPaused = i.grabs_paused_until != null || i.grabs_paused
  const details: string[] = []
  if (i.state === 'failing' && i.message) details.push(i.message)
  if (i.state === 'ok') {
    details.push(i.search_max == null ? `${i.search_used} searches today` : `${i.search_used} of ${i.search_max} searches today`)
  }
  if (i.search_paused_until) details.push(`Searches paused until ${clockTime(i.search_paused_until)}`)
  if (i.grabs_paused_until) details.push(`Grabs paused until ${clockTime(i.grabs_paused_until)}`)
  else if (i.grabs_paused) details.push(`Grabs paused (${i.grab_used ?? '?'} of ${i.grab_max ?? '?'} downloads used)`)
  const tone: Tone = i.state === 'failing' ? 'failing' : i.state === 'disabled' ? 'idle' : searchPaused || grabsPaused ? 'paused' : 'ok'
  return {
    key: `indexer-${i.instance_id}`,
    name: i.name,
    instanceId: i.instance_id,
    tone,
    word: i.state === 'disabled' ? 'disabled' : undefined,
    details,
    meter: i.state === 'ok' && i.search_max != null ? { value: i.search_used, max: i.search_max, warn: searchPaused, label: `${i.name} searches used today` } : undefined,
  }
}

function diskTile(d: SystemStatus['disks'][number]): TileData {
  const low = d.free_bytes < d.low_free_bytes
  return {
    key: `disk-${d.path}`,
    name: d.path,
    tone: low ? 'low' : 'ok',
    details: [`${formatBytes(d.free_bytes)} free of ${formatBytes(d.total_bytes)}`],
    meter: { value: Math.max(0, d.total_bytes - d.free_bytes), max: d.total_bytes, warn: low, label: `${d.path} space used` },
  }
}

/** "from today", "1 day old", "12 days old"; "age unknown" when the snapshot has no date. */
export function snapshotAge(committedAt: string | null, now = Date.now()): string {
  if (!committedAt) return 'age unknown'
  const days = Math.max(0, Math.floor((now - Date.parse(committedAt)) / 86_400_000))
  return days === 0 ? 'from today' : `${days} day${days === 1 ? '' : 's'} old`
}

export type HealthGroup = { title: string; tiles: TileData[] }

/**
 * The groups that have a tile in them, each with its failing tiles first, and how many tiles fail, warn or are ok.
 * Only the download client and the indexers can fail; a low disk or a pause is a warning, not a failure.
 * Everything else (ok, off, an update to install) is ok, so the three counts add up to the number of tiles.
 */
export function healthOf(s: SystemStatus): { groups: HealthGroup[]; failing: number; warnings: number; ok: number } {
  const rest: TileData[] = []
  if (s.grabs_paused) rest.push({ key: 'grabs', name: 'Grabs', tone: 'paused', details: ['Automatic Grabs are paused'] })
  rest.push({ key: 'trash', name: 'TRaSH', tone: 'ok', details: [snapshotAge(s.trash.committed_at)] })
  if (s.update) rest.push({ key: 'update', name: 'Update', tone: 'update', details: [`Kestrel ${s.update.version} available`], link: { path: '/about', label: 'About' } })
  const groups = [
    { title: 'Download client', tiles: [clientTile(s.download_client)] },
    { title: 'Indexers', tiles: s.indexers.map(indexerTile) },
    { title: 'Disks', tiles: s.disks.map(diskTile) },
    { title: 'Other', tiles: rest },
  ]
    .filter((g) => g.tiles.length > 0)
    .map((g) => ({ ...g, tiles: [...g.tiles].sort((a, b) => Number(b.tone === 'failing') - Number(a.tone === 'failing')) }))
  const tiles = groups.flatMap((g) => g.tiles)
  const failing = tiles.filter((t) => t.tone === 'failing').length
  const warnings = tiles.filter((t) => t.tone === 'paused' || t.tone === 'low').length
  return { groups, failing, warnings, ok: tiles.length - failing - warnings }
}

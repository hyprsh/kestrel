// The Health checks as tiles in three groups: Connections (the download client, the indexers, the metadata providers and
// the media servers), Storage (each disk) and System (the version, the TRaSH snapshot, Grabs). Failing tiles come first in
// their group and say since when. Used by the Health screen, Settings (which pages need attention) and the Trash.
import type { SystemStatus } from '../api/attention'
import { clockTime } from '../time'
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

/** "12:12" for a time today, "Oct 30, 12:12" for an earlier day. */
export function sinceOf(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date(now).toDateString()) return clockTime(iso)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clockTime(iso)}`
}

/** "API key rejected" and "12:12" make "API key rejected, since 12:12". */
export function failingSince(message: string, since: string | null | undefined, now = Date.now()): string {
  const m = message.replace(/[.\s]+$/, '')
  return since ? `${m}, since ${sinceOf(since, now)}` : m
}

function clientTile(s: SystemStatus['download_client'], now: number): TileData {
  if (s.state === 'none') return { key: 'client', name: 'Download client', tone: 'idle', word: 'not set up', detail: 'No download client set up' }
  return {
    key: 'client',
    name: s.name ?? 'Download client',
    instanceId: s.instance_id,
    tone: s.state === 'ok' ? 'ok' : 'failing',
    detail: s.state === 'ok' ? 'Connected' : failingSince(s.message ?? 'Not answering', s.since, now),
  }
}

type Indexer = SystemStatus['indexers'][number]

const searches = (i: Indexer) => (i.search_max == null ? `${i.search_used} searches today` : `${i.search_used} of ${i.search_max} searches today`)

/** An indexer that fails, is off or is paused has a tile of its own; the others answer, and share one. */
function indexerTile(i: Indexer, now: number): TileData {
  const details: string[] = []
  if (i.search_paused_until) details.push(`Searches paused until ${clockTime(i.search_paused_until)}`)
  if (i.grabs_paused_until) details.push(`Grabs paused until ${clockTime(i.grabs_paused_until)}`)
  else if (i.grabs_paused) details.push(`Grabs paused (${i.grab_used ?? '?'} of ${i.grab_max ?? '?'} downloads used)`)
  const paused = details.length > 0
  const tone: Tone = i.state === 'failing' ? 'failing' : i.state === 'disabled' ? 'idle' : paused ? 'paused' : 'ok'
  const detail = i.state === 'failing' ? failingSince(i.message ?? 'Not answering', i.since, now) : i.state === 'disabled' ? 'Disabled' : paused ? details.join(' · ') : `Answering · ${searches(i)}`
  return { key: `indexer-${i.instance_id}`, instanceId: i.instance_id, name: i.name, tone, word: i.state === 'disabled' ? 'disabled' : undefined, detail }
}

/** Every indexer on its own, except that the ones answering fine are one tile when there are two or more. */
function indexerTiles(list: Indexer[], now: number): TileData[] {
  const own = list.map((i) => indexerTile(i, now))
  const fine = own.filter((t) => t.tone === 'ok')
  if (fine.length < 2) return own
  const used = list.filter((i) => fine.some((t) => t.instanceId === i.instance_id)).reduce((n, i) => n + i.search_used, 0)
  const group: TileData = {
    key: 'indexers-ok',
    name: list
      .filter((i) => fine.some((t) => t.instanceId === i.instance_id))
      .map((i) => i.name)
      .join(', '),
    tone: 'ok',
    detail: `Answering · ${used} searches today`,
  }
  return [...own.filter((t) => t.tone !== 'ok'), group]
}

function serviceTile(s: SystemStatus['services'][number], now: number): TileData {
  const media = s.kind === 'media_server'
  return {
    key: media ? `media-server-${s.instance_id}` : `metadata-${s.name}`,
    instanceId: media ? s.instance_id : undefined,
    name: s.name,
    tone: s.state === 'failing' ? 'failing' : 'ok',
    detail: s.state === 'failing' ? failingSince(s.message ?? 'Not answering', s.since, now) : media ? 'Connected' : 'No problems seen',
  }
}

function diskTile(d: SystemStatus['disks'][number]): TileData {
  const low = d.free_bytes < d.low_free_bytes
  const used = d.total_bytes > 0 ? Math.round(((d.total_bytes - d.free_bytes) / d.total_bytes) * 100) : 0
  return { key: `disk-${d.path}`, name: d.path, tone: low ? 'low' : 'ok', word: low ? 'low' : undefined, detail: `${formatBytes(d.free_bytes)} free · ${used}% used${low ? ' · low' : ''}` }
}

/** "from today", "1 day old", "12 days old"; "age unknown" when the snapshot has no date. */
export function snapshotAge(committedAt: string | null, now = Date.now()): string {
  if (!committedAt) return 'age unknown'
  const days = Math.max(0, Math.floor((now - Date.parse(committedAt)) / 86_400_000))
  return days === 0 ? 'from today' : `${days} day${days === 1 ? '' : 's'} old`
}

export type HealthGroup = { title: string; tiles: TileData[] }

const failingFirst = (tiles: TileData[]) => [...tiles].sort((a, b) => Number(b.tone === 'failing') - Number(a.tone === 'failing'))

/**
 * The groups that have a tile in them, each with its failing tiles first, and how many tiles fail, warn or are ok.
 * Only the download client, the indexers, the metadata providers and the media servers can fail; a low disk or a pause is a
 * warning, not a failure. Everything else (ok, off, an update to install) is ok, so the three counts add up to the number
 * of tiles. The database and the clock have no check, so they have no tile.
 */
export function healthOf(s: SystemStatus, now = Date.now()): { groups: HealthGroup[]; failing: number; warnings: number; ok: number } {
  const system: TileData[] = []
  system.push(
    s.update
      ? { key: 'update', name: 'Version', tone: 'update', detail: `${s.version} · ${s.update.version} available`, link: { path: '/settings/about', label: 'About' } }
      : { key: 'version', name: 'Version', tone: 'ok', detail: `${s.version} · up to date` },
  )
  system.push({ key: 'trash', name: 'TRaSH', tone: 'ok', detail: `Snapshot ${snapshotAge(s.trash.committed_at, now)}` })
  if (s.grabs_paused) system.push({ key: 'grabs', name: 'Grabs', tone: 'paused', detail: 'Automatic Grabs are paused' })
  const groups = [
    { title: 'Connections', tiles: [clientTile(s.download_client, now), ...indexerTiles(s.indexers, now), ...s.services.map((v) => serviceTile(v, now))] },
    { title: 'Storage', tiles: s.disks.map(diskTile) },
    { title: 'System', tiles: system },
  ]
    .filter((g) => g.tiles.length > 0)
    .map((g) => ({ ...g, tiles: failingFirst(g.tiles) }))
  const tiles = groups.flatMap((g) => g.tiles)
  const failing = tiles.filter((t) => t.tone === 'failing').length
  const warnings = tiles.filter((t) => t.tone === 'paused' || t.tone === 'low').length
  return { groups, failing, warnings, ok: tiles.length - failing - warnings }
}

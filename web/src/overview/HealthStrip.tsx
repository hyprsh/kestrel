// The Health section: one tile per item (download client, indexers, disks, the rest), failing
// first, each with its state as an icon and a word, never colour alone.
import { Button, Progress } from '@hyprsh/design'
import { CircleAlert, CircleArrowUp, CircleCheck, CircleMinus, CirclePause, type LucideIcon } from 'lucide-react'
import { useStatus, type SystemStatus } from '../api/attention'
import { useOpenPlace } from '../place'
import { clockTime } from '../time'
import { cx } from '../ui'

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

type Tone = 'ok' | 'failing' | 'paused' | 'low' | 'idle' | 'update'

const toneUi: Record<Tone, { icon: LucideIcon; text: string; tile: string; word: string }> = {
  ok: { icon: CircleCheck, text: 'text-gray-900', tile: 'border-gray-alpha-400', word: 'ok' },
  failing: { icon: CircleAlert, text: 'text-red-900', tile: 'border-red-700 bg-red-100', word: 'failing' },
  paused: { icon: CirclePause, text: 'text-amber-900', tile: 'border-amber-700 bg-amber-100', word: 'paused' },
  low: { icon: CircleAlert, text: 'text-amber-900', tile: 'border-amber-700 bg-amber-100', word: 'low' },
  idle: { icon: CircleMinus, text: 'text-gray-900', tile: 'border-gray-alpha-400', word: 'off' },
  update: { icon: CircleArrowUp, text: 'text-blue-900', tile: 'border-blue-700 bg-blue-100', word: 'update' },
}

type TileData = {
  key: string
  name: string
  tone: Tone
  /** Replaces the tone's word ("low" for a disk, "not set up"). */
  word?: string
  details: string[]
  meter?: { value: number; max: number; warn: boolean; label: string }
  /** Opens a place, such as About for an update. */
  link?: { path: string; label: string }
}

function Tile({ tile }: { tile: TileData }) {
  const openPlace = useOpenPlace()
  const ui = toneUi[tile.tone]
  const Icon = ui.icon
  return (
    <li className={cx('rounded-lg border px-3 py-2', ui.tile)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{tile.name}</span>
        <span className={cx('label-12 flex shrink-0 items-center gap-1', ui.text)}>
          <Icon size={14} aria-hidden />
          {tile.word ?? ui.word}
        </span>
      </div>
      {tile.details.map((d) => (
        <p key={d} className="label-12 mt-0.5 text-gray-900">
          {d}
        </p>
      ))}
      {tile.meter && (
        <div className="mt-1.5">
          <Progress value={tile.meter.value} max={tile.meter.max} type={tile.meter.warn ? 'warning' : 'default'} height={6} aria-label={tile.meter.label} />
        </div>
      )}
      {tile.link && (
        <Button variant="tertiary" size="small" className="mt-1 -ml-3" onClick={() => openPlace(tile.link!.path)}>
          {tile.link.label}
        </Button>
      )}
    </li>
  )
}

function clientTile(s: SystemStatus['download_client']): TileData {
  if (s.state === 'none') return { key: 'client', name: 'Download client', tone: 'idle', word: 'not set up', details: ['No download client set up'] }
  return {
    key: 'client',
    name: s.name ?? 'Download client',
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

const failingFirst = (tiles: TileData[]) => [...tiles].sort((a, b) => Number(b.tone === 'failing') - Number(a.tone === 'failing'))

function Group({ title, tiles }: { title: string; tiles: TileData[] }) {
  if (tiles.length === 0) return null
  return (
    <div>
      <h3 className="label-12 mb-1.5 text-gray-900">{title}</h3>
      <ul className="flex flex-col gap-2">
        {failingFirst(tiles).map((t) => (
          <Tile key={t.key} tile={t} />
        ))}
      </ul>
    </div>
  )
}

export function HealthStrip() {
  const s = useStatus().data
  const rest: TileData[] = []
  if (s) {
    if (s.grabs_paused) rest.push({ key: 'grabs', name: 'Grabs', tone: 'paused', details: ['Automatic Grabs are paused'] })
    rest.push({ key: 'trash', name: 'TRaSH', tone: 'ok', details: [snapshotAge(s.trash.committed_at)] })
    if (s.update) rest.push({ key: 'update', name: 'Update', tone: 'update', details: [`Kestrel ${s.update.version} available`], link: { path: '/about', label: 'About' } })
  }
  const clients = s ? [clientTile(s.download_client)] : []
  const indexers = s ? s.indexers.map(indexerTile) : []
  const disks = s ? s.disks.map(diskTile) : []
  const failing = [...clients, ...indexers].filter((t) => t.tone === 'failing').length
  const summary = !s ? '' : failing > 0 ? ` · ${failing} failing` : ' · all good'
  return (
    <section aria-labelledby="health-strip">
      <h2 id="health-strip" className="heading-14 mb-3">
        {`Health${summary}`}
      </h2>
      {s && (
        <div className="flex flex-col gap-4">
          <Group title="Download client" tiles={clients} />
          <Group title="Indexers" tiles={indexers} />
          <Group title="Disks" tiles={disks} />
          <Group title="Other" tiles={rest} />
        </div>
      )}
    </section>
  )
}

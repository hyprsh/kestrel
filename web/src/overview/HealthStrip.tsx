// The health strip: capacity at a glance, how old the TRaSH snapshot is, and whether Grabs are paused.
import { useStatus, type SystemStatus } from '../api/attention'
import { cx } from '../ui'

/** "800 GB", "1 TB": powers of 1024, no decimals once a number is round. */
export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${units[i]}`
}

function Item({ label, state, detail }: { label: string; state: 'ok' | 'failing' | 'idle'; detail: string }) {
  return (
    <div className="flex items-center gap-2" title={detail}>
      <span className={cx('size-1.5 rounded-full', state === 'ok' && 'bg-green-700', state === 'failing' && 'bg-red-700', state === 'idle' && 'bg-gray-600')} />
      <span className="font-medium">{label}</span>
      <span className="text-gray-900">{detail}</span>
    </div>
  )
}

function client(s: SystemStatus['download_client']) {
  if (s.state === 'none') return <Item label="Download client" state="idle" detail="No download client set up" />
  return <Item label={s.name ?? 'Download client'} state={s.state === 'ok' ? 'ok' : 'failing'} detail={s.state === 'ok' ? 'ok' : `failing${s.message ? `: ${s.message}` : ''}`} />
}

type Indexer = SystemStatus['indexers'][number]

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The budget and pauses after the state: "ok · 42 of 100 searches today · searches paused until 14:05". */
function indexerDetail(i: Indexer): string {
  const parts: string[] = [i.state === 'failing' && i.message ? `failing: ${i.message}` : i.state]
  if (i.state !== 'disabled') {
    parts.push(i.search_max == null ? `${i.search_used} searches today` : `${i.search_used} of ${i.search_max} searches today`)
  }
  if (i.search_paused_until) parts.push(`searches paused until ${clockTime(i.search_paused_until)}`)
  if (i.grabs_paused_until) parts.push(`Grabs paused until ${clockTime(i.grabs_paused_until)}`)
  else if (i.grabs_paused) parts.push(`Grabs paused (${i.grab_used ?? '?'} of ${i.grab_max ?? '?'} downloads used)`)
  return parts.join(' · ')
}

/** "from today", "1 day old", "12 days old"; "age unknown" when the snapshot has no date. */
export function snapshotAge(committedAt: string | null, now = Date.now()): string {
  if (!committedAt) return 'age unknown'
  const days = Math.max(0, Math.floor((now - Date.parse(committedAt)) / 86_400_000))
  return days === 0 ? 'from today' : `${days} day${days === 1 ? '' : 's'} old`
}

export function HealthStrip() {
  const status = useStatus()
  const s = status.data
  return (
    <section aria-labelledby="health-strip" className="mx-auto mb-8 max-w-3xl">
      <h2 id="health-strip" className="mb-3 text-sm font-medium">
        Health
      </h2>
      {s && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-gray-alpha-400 px-4 py-3 text-[12px]">
          {s.grabs_paused && <Item label="Grabs" state="idle" detail="Automatic Grabs are paused" />}
          {client(s.download_client)}
          {s.indexers.map((i) => (
            <Item
              key={i.instance_id}
              label={i.name}
              state={i.state === 'ok' ? 'ok' : i.state === 'failing' ? 'failing' : 'idle'}
              detail={indexerDetail(i)}
            />
          ))}
          <Item label="TRaSH" state="idle" detail={snapshotAge(s.trash.committed_at)} />
          {s.update && <Item label="Update" state="idle" detail={`Kestrel ${s.update.version} available`} />}
          {s.disks.map((d) => (
            <Item key={d.path} label={d.path} state="idle" detail={`${formatBytes(d.free_bytes)} free of ${formatBytes(d.total_bytes)}`} />
          ))}
        </div>
      )}
    </section>
  )
}

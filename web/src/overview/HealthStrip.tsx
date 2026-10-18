// The health strip: capacity at a glance. Budgets, TRaSH age and updates join it with their own tickets.
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
          {client(s.download_client)}
          {s.indexers.map((i) => (
            <Item
              key={i.instance_id}
              label={i.name}
              state={i.state === 'ok' ? 'ok' : i.state === 'failing' ? 'failing' : 'idle'}
              detail={i.state === 'failing' && i.message ? `failing: ${i.message}` : i.state}
            />
          ))}
          {s.update && <Item label="Update" state="idle" detail={`Kestrel ${s.update.version} available`} />}
          {s.disks.map((d) => (
            <Item key={d.path} label={d.path} state="idle" detail={`${formatBytes(d.free_bytes)} free of ${formatBytes(d.total_bytes)}`} />
          ))}
        </div>
      )}
    </section>
  )
}

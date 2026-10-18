// Overview, the home screen: Needs attention, the health strip, Downloading now,
// Coming this week and Recently added.
import { useQueue, useCancelGrab, type QueueItem } from '../api/queue'
import { Button, ErrorText } from '../forms'
import { slotLabel, type SlotKey } from '../library/bits'
import { Badge, cx } from '../ui'
import { ComingRecent } from './ComingRecent'
import { HealthStrip } from './HealthStrip'
import { NeedsAttention } from './NeedsAttention'

const phaseLabel: Record<QueueItem['phase'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  post_processing: 'Processing',
  importing: 'Importing',
}

/** Percent done, or null when the client has not said how big the job is. */
function percent(i: QueueItem): number | null {
  if (i.phase === 'importing') return 100
  if (i.bytes_total <= 0) return null
  return Math.min(100, Math.max(0, Math.round(((i.bytes_total - i.bytes_left) / i.bytes_total) * 100)))
}

/** "45 s", "2 min" or "1 h 5 min" left. */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s left`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min left`
  return `${Math.floor(mins / 60)} h ${mins % 60} min left`
}

/** onOpen is how an action that opens a place in the app (a GET action) gets there. */
export function Overview({ onOpen = () => {}, onOpenTitle = () => {} }: { onOpen?: (path: string) => void; onOpenTitle?: (id: number) => void }) {
  const queue = useQueue()
  const cancel = useCancelGrab()
  const items = queue.data ?? []
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <NeedsAttention onOpen={onOpen} />
      <HealthStrip />
      <section aria-labelledby="downloading-now" className="mx-auto max-w-3xl">
        <h2 id="downloading-now" className="mb-3 text-sm font-medium">
          Downloading now
        </h2>
        {cancel.isError && <ErrorText>{cancel.error.message}</ErrorText>}
        {queue.data && items.length === 0 ? (
          <p className="text-gray-900">Nothing is downloading.</p>
        ) : (
          <ul className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {items.map((i) => (
              <Row key={i.grab_id} item={i} busy={cancel.isPending} onCancel={(blocklist) => cancel.mutate({ id: i.grab_id, blocklist })} />
            ))}
          </ul>
        )}
      </section>
      <ComingRecent onOpenTitle={onOpenTitle} />
    </div>
  )
}

function Row({ item: i, busy, onCancel }: { item: QueueItem; busy: boolean; onCancel: (blocklist: boolean) => void }) {
  const pct = percent(i)
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{i.title || 'Deleted Title'}</span>
        {i.year ? <span className="text-gray-900">{i.year}</span> : null}
        {i.slot && <Badge>{slotLabel[i.slot as SlotKey]}</Badge>}
        {i.episodes.length > 0 && <span className="text-gray-900">{i.episodes.join(', ')}</span>}
        {i.is_upgrade && (
          <Badge tone="purple">
            Upgrade
            {i.score_delta != null && <span className="ml-1">{`+${i.score_delta}`}</span>}
          </Badge>
        )}
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => onCancel(false)}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onCancel(true)}>
            Cancel and blocklist
          </Button>
        </span>
      </div>
      <div className="truncate font-mono text-[12px] text-gray-900">{i.release_name}</div>
      <div className="flex items-center gap-3 text-[12px] text-gray-900">
        <span className={cx('w-24', i.phase === 'paused' && 'text-amber-900')}>{phaseLabel[i.phase]}</span>
        {pct !== null && (
          <>
            <div
              role="progressbar"
              aria-label={`${i.release_name} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-alpha-200"
            >
              <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{pct}%</span>
          </>
        )}
        {i.eta != null && <span>{formatEta(i.eta)}</span>}
      </div>
    </li>
  )
}

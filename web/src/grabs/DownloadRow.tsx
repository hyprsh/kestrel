// One active Grab as "Downloading now" draws it, shared by the Overview, the Title page and Activity.
import type { ReactNode } from 'react'
import type { QueueItem } from '../api/queue'
import { Button } from '../forms'
import { cx } from '../ui'
import { GrabRow, type RowNav } from './GrabRow'
import { phases } from './phase'

/** Percent done, or null when the client has not said how big the job is. */
function percent(i: QueueItem): number | null {
  if (i.phase === 'importing') return 100
  if (i.bytes_total <= 0) return null
  return Math.min(100, Math.max(0, Math.round(((i.bytes_total - i.bytes_left) / i.bytes_total) * 100)))
}

/** "45 s", "2 min" or "1 h 5 min" left. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s left`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min left`
  return `${Math.floor(mins / 60)} h ${mins % 60} min left`
}

/**
 * An active Grab's row: the Grab, its phase, progress and the Cancel actions, with
 * `detail` (Activity's indexer, Score and times) above the progress.
 */
export function DownloadRow({
  item: i,
  nav,
  withTitle = true,
  busy,
  onCancel,
  onOpenTitle,
  detail,
}: {
  item: QueueItem
  nav?: RowNav
  withTitle?: boolean
  busy: boolean
  onCancel: (blocklist: boolean) => void
  onOpenTitle?: (id: number) => void
  detail?: ReactNode
}) {
  const pct = percent(i)
  return (
    <GrabRow
      grab={i}
      nav={nav}
      withTitle={withTitle}
      onOpenTitle={onOpenTitle}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onCancel(false)}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onCancel(true)}>
            Cancel and blocklist
          </Button>
        </>
      }
    >
      {detail}
      <div className="flex items-center gap-3 text-[12px] text-gray-900">
        <span className={cx('w-24', i.phase === 'paused' && 'text-amber-900')}>{phases[i.phase].label}</span>
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
    </GrabRow>
  )
}

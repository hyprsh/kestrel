// One active Grab as "Downloading now" draws it, shared by the Overview, the Title page and Activity.
import { Button, Progress } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { span } from '../time'
import { cx } from '../ui'
import type { RowNav } from '../keys'
import { GrabRow } from './GrabRow'
import { phases } from './phase'

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
  // An importing Grab is all downloaded; null when the client has not said how big the job is.
  const pct = i.phase === 'importing' ? 100 : percent(i.bytes_total, i.bytes_left)
  return (
    <GrabRow
      grab={i}
      nav={nav}
      withTitle={withTitle}
      onOpenTitle={onOpenTitle}
      actions={
        <>
          <Button variant="secondary" size="small" disabled={busy} onClick={() => onCancel(false)}>
            Cancel
          </Button>
          <Button variant="secondary" size="small" disabled={busy} onClick={() => onCancel(true)}>
            Cancel and blocklist
          </Button>
        </>
      }
    >
      {detail}
      <div className="label-12 flex items-center gap-3 text-gray-900">
        <span className={cx('w-24', i.phase === 'paused' && 'text-amber-900')}>{phases[i.phase].label}</span>
        {pct !== null && (
          <>
            <Progress value={pct} type="success" height={6} aria-label={`${i.release_name} progress`} className="flex-1" />
            <span className="w-10 text-right tabular-nums">{pct}%</span>
          </>
        )}
        {i.eta != null && <span>{`${span(i.eta * 1000)} left`}</span>}
      </div>
    </GrabRow>
  )
}

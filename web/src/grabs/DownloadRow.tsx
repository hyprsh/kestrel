// One active Grab as "Downloading now" draws it, shared by the Overview and the Title page.
import type { QueueItem } from '../api/queue'
import { Button } from '../forms'
import { slotLabel, type SlotKey } from '../library/bits'
import { TitlePoster } from '../poster'
import { Badge, cx, NavRow } from '../ui'

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
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s left`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min left`
  return `${Math.floor(mins / 60)} h ${mins % 60} min left`
}

/** Where a row sits in a j/k list (`NavRow`); a row outside one is a plain list item. */
type RowNav = { scope: string; index: number; sel: number; onSelect: () => void }

/**
 * A Grab's row: its Title's poster and name (left out with `withTitle={false}`,
 * on the Title's own page), Slot, episodes, Release, phase, progress and the
 * Cancel actions. Clicking the poster or the name opens the Title.
 */
export function DownloadRow({
  item: i,
  nav,
  withTitle = true,
  busy,
  onCancel,
  onOpenTitle,
}: {
  item: QueueItem
  nav?: RowNav
  withTitle?: boolean
  busy: boolean
  onCancel: (blocklist: boolean) => void
  onOpenTitle?: (id: number) => void
}) {
  const pct = percent(i)
  const id = i.title_id
  const open = id != null && onOpenTitle ? () => onOpenTitle(id) : undefined
  const className = 'flex gap-3 px-4 py-3'
  const body = (
    <>
      {withTitle &&
        (id != null ? (
          // The name is the keyboard way in; the poster is a bigger mouse target for the same thing.
          <span onClick={open} className="shrink-0">
            <TitlePoster id={id} hasPoster={i.has_poster} className="h-15 w-10 rounded-sm" />
          </span>
        ) : (
          <span className="w-10 shrink-0" />
        ))}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {withTitle &&
            (open ? (
              <button type="button" onClick={open} className="cursor-pointer font-medium hover:underline">
                {i.title || 'Deleted Title'}
              </button>
            ) : (
              <span className="font-medium">{i.title || 'Deleted Title'}</span>
            ))}
          {withTitle && i.year ? <span className="text-gray-900">{i.year}</span> : null}
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
      </div>
    </>
  )
  return nav ? (
    <NavRow scope={nav.scope} index={nav.index} sel={nav.sel} onSelect={nav.onSelect} className={className}>
      {body}
    </NavRow>
  ) : (
    <li className={className}>{body}</li>
  )
}

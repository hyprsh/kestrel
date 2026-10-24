// chrome: pending
// The frame of every Grab's row: the Title's poster and name, Slot, episodes and Release, with
// the lines and actions the caller brings. Downloading now, the Title page and Activity share it.
import { Badge } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { QueueItem } from '../api/queue'
import { slotLabel, type SlotKey } from '../library/bits'
import type { RowNav } from '../keys'
import { TitlePoster } from '../poster'
import { NavRow } from '../ui'

/** What a row shows of the Grab's Title and Release: a queue item or a listed Grab. */
type GrabSubject = Pick<QueueItem, 'title_id' | 'has_poster' | 'title' | 'year' | 'slot' | 'episodes' | 'release_name' | 'is_upgrade'> & {
  score_delta?: number | null
}

/**
 * A Grab's row: its Title's poster and name (left out with `withTitle={false}`, on the
 * Title's own page), Slot, episodes, Release, then `children` and the `actions`.
 * Clicking the poster or the name opens the Title.
 */
export function GrabRow({
  grab: g,
  nav,
  withTitle = true,
  onOpenTitle,
  actions,
  children,
}: {
  grab: GrabSubject
  nav?: RowNav
  withTitle?: boolean
  onOpenTitle?: (id: number) => void
  actions?: ReactNode
  children?: ReactNode
}) {
  const id = g.title_id
  const open = id != null && onOpenTitle ? () => onOpenTitle(id) : undefined
  const className = 'flex gap-3 px-4 py-3'
  const body = (
    <>
      {withTitle &&
        (id != null ? (
          // The name is the keyboard way in; the poster is a bigger mouse target for the same thing.
          <span onClick={open} className="shrink-0">
            <TitlePoster id={id} hasPoster={g.has_poster} className="h-15 w-10 rounded-sm" />
          </span>
        ) : (
          <span className="w-10 shrink-0" />
        ))}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {withTitle &&
            (open ? (
              <button type="button" onClick={open} className="label-14 cursor-pointer hover:underline">
                {g.title || 'Deleted Title'}
              </button>
            ) : (
              <span className="label-14">{g.title || 'Deleted Title'}</span>
            ))}
          {withTitle && g.year ? <span className="label-14 text-gray-900">{g.year}</span> : null}
          {g.slot && (
            <Badge variant="gray-subtle" size="sm">
              {slotLabel[g.slot as SlotKey]}
            </Badge>
          )}
          {g.episodes.length > 0 && <span className="label-14 text-gray-900">{g.episodes.join(', ')}</span>}
          {g.is_upgrade && (
            <Badge variant="purple-subtle" size="sm">
              Upgrade
              {g.score_delta != null && <span className="ml-1">{`+${g.score_delta}`}</span>}
            </Badge>
          )}
          {actions && <span className="ml-auto flex gap-2">{actions}</span>}
        </div>
        <div className="label-12-mono truncate text-gray-900">{g.release_name}</div>
        {children}
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

// The frame of every Grab's row: the Title's poster and name, Slot, episodes and Release, with
// the lines and actions the caller brings. Downloading now, the Title page and Activity share it.
import { Badge, Entity, Link } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { QueueItem } from '../api/queue'
import { slotLabel, type SlotKey } from '../library/bits'
import type { RowNav } from '../keys'
import { TitlePoster } from '../poster'

/** What a row shows of the Grab's Title and Release: a queue item or a listed Grab. */
type GrabSubject = Pick<QueueItem, 'title_id' | 'has_poster' | 'title' | 'year' | 'slot' | 'episodes' | 'release_name' | 'is_upgrade'> & {
  score_delta?: number | null
}

/**
 * A Grab's row: its Title's poster and name (left out with `withTitle={false}`, on the
 * Title's own page), Slot, episodes, Release, then `children` and the `actions`.
 * Clicking the poster or the name opens the Title. With `nav` the row is the j/k cursor: an Entity with `current`
 * that selects on click; without it the Entity is a plain list item.
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
  const name = g.title || 'Deleted Title'
  const title = (
    <span className="flex items-center gap-2">
      {withTitle &&
        (open ? (
          <Link as="button" type="button" onClick={open}>
            {name}
          </Link>
        ) : (
          <span>{name}</span>
        ))}
      {withTitle && g.year ? <span className="font-normal text-gray-900">{g.year}</span> : null}
      {g.slot && (
        <Badge variant="gray" contrast="low" size="sm">
          {slotLabel[g.slot as SlotKey]}
        </Badge>
      )}
      {g.episodes.length > 0 && <span className="font-normal text-gray-900">{g.episodes.join(', ')}</span>}
      {g.is_upgrade && (
        <Badge variant="purple" contrast="low" size="sm">
          Upgrade
          {g.score_delta != null && <span className="ml-1">{`+${g.score_delta}`}</span>}
        </Badge>
      )}
    </span>
  )
  // The name is the keyboard way in; the poster is a bigger mouse target for the same thing.
  const left = withTitle ? (
    id != null ? (
      <span onClick={open}>
        <TitlePoster id={id} hasPoster={g.has_poster} size="md" />
      </span>
    ) : (
      <span className="w-10" />
    )
  ) : undefined
  return (
    <Entity
      as={nav ? 'button' : 'li'}
      current={nav ? nav.index === nav.sel : undefined}
      data-nav={nav ? `${nav.scope}-${nav.index}` : undefined}
      onClick={nav?.onSelect}
      left={left}
      right={actions}
      className="max-sm:flex-col max-sm:items-stretch"
    >
      <Entity.Content fill title={title} description={<span className="label-12-mono">{g.release_name}</span>}>
        {children}
      </Entity.Content>
    </Entity>
  )
}

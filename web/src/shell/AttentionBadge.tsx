// chrome: waiting hyprsh/design#35
// How many rows need attention, pinned over the corner of a rail Button. Waits for Button to take
// `badge`, `badgeTone` and `badgeLabel`, as TabBar.Item does.
import { Badge } from '@hyprsh/design'

/** How many rows need attention; red while any is Blocking. */
export function AttentionBadge({ count, blocking }: { count: number; blocking: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none absolute -top-1 -right-1">
      <Badge variant={blocking ? 'red' : 'amber'} size="sm">
        {count}
      </Badge>
    </span>
  )
}

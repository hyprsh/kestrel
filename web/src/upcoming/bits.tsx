import { Badge } from '@hyprsh/design'
import type { UpcomingItem } from '../api/upcoming'

const releaseLabel = { theatrical: 'In cinemas', digital: 'Digital', physical: 'Physical' } as const

/** "Sat 18 Oct" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** A stable React key for an agenda line. */
export const upcomingKey = (item: UpcomingItem) =>
  `${item.kind}-${item.title_id}-${item.season ?? ''}-${item.episode ?? ''}-${item.release_type ?? ''}`

/** One agenda line: an episode airing, or a typed Movie release with when it becomes searchable. */
export function UpcomingLine({ item }: { item: UpcomingItem }) {
  if (item.kind === 'series') {
    const code = `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
    return (
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{item.title}</span> <span className="text-gray-900">{code}</span>
        {item.episode_name ? <span className="text-gray-900"> · {item.episode_name}</span> : null}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">
        <span className="font-medium">{item.title}</span>
        {item.year ? <span className="text-gray-900"> {item.year}</span> : null}
      </span>
      {item.release_type && <Badge variant="blue-subtle" size="sm">{releaseLabel[item.release_type]}</Badge>}
      {!item.released && (
        <span className="label-12 text-gray-900">{item.searchable_from ? `searchable from ${item.searchable_from}` : 'no search date yet'}</span>
      )}
    </span>
  )
}

import type { Episode } from '../api/queries'

/**
 * An episode's title in the Primary Language, with the original title beneath
 * it, smaller, when the two differ (as the Library list does for Titles). A
 * Placeholder Episode has neither and shows as TBA.
 */
export function EpisodeName({ episode }: { episode: Episode }) {
  const primary = episode.primary_name || episode.name
  if (!primary) return <span className="min-w-0 truncate">TBA</span>
  const original = episode.original_name || episode.name
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{primary}</span>
      {original && original !== primary && <span className="truncate text-[12px] text-gray-900">{original}</span>}
    </span>
  )
}

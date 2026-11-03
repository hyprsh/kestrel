// The one monitoring symbol: a bookmark with a check in green when monitored, the outline in gray when not.
import { Bookmark, BookmarkCheck } from 'lucide-react'

/** The mark alone, for a row that shows the state without a button (the Library list). */
export function MonitorMark({ monitored, size = 16, label }: { monitored: boolean; size?: number; label?: string }) {
  const Icon = monitored ? BookmarkCheck : Bookmark
  return <Icon aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} width={size} height={size} className={monitored ? 'text-green-800' : 'text-gray-700'} />
}

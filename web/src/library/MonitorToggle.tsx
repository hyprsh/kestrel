// The one monitoring symbol: a bookmark with a check in green when monitored, the outline in gray when not. Every
// toggle (a season, an episode, a Movie's row mark) is a real button with aria-pressed and a label that says what a
// press does: "Stop monitoring Season 2", "Monitor S05E03".
import { Button } from '@hyprsh/design'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import type { FocusEventHandler } from 'react'

/** The mark alone, for a row that shows the state without a button (the Library list). */
export function MonitorMark({ monitored, size = 16, label }: { monitored: boolean; size?: number; label?: string }) {
  const Icon = monitored ? BookmarkCheck : Bookmark
  return <Icon aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} width={size} height={size} className={monitored ? 'text-green-800' : 'text-gray-700'} />
}

export function MonitorToggle({
  name,
  monitored,
  onToggle,
  size = 'tiny',
  iconSize = 16,
  tabIndex,
  onFocus,
  disabled,
}: {
  /** What it monitors: "Season 2", "S05E03". */
  name: string
  monitored: boolean
  onToggle: () => void
  size?: 'tiny' | 'small' | 'medium'
  iconSize?: number
  tabIndex?: number
  onFocus?: FocusEventHandler<HTMLButtonElement>
  disabled?: boolean
}) {
  return (
    <Button
      variant="tertiary"
      size={size}
      svgOnly
      aria-pressed={monitored}
      aria-label={`${monitored ? 'Stop monitoring' : 'Monitor'} ${name}`}
      title={monitored ? 'Monitored' : 'Not monitored'}
      tabIndex={tabIndex}
      onFocus={onFocus}
      disabled={disabled}
      data-monitor=""
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <MonitorMark monitored={monitored} size={iconSize} />
    </Button>
  )
}

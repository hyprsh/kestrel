import { Button, Tooltip } from '@hyprsh/design'
import type { LucideIcon } from 'lucide-react'
import type { FocusEventHandler } from 'react'

/** An icon-only action: the tooltip and the accessible name are `label`, which names what it acts on ("Search S05E05"). */
export function IconAction({
  icon: Icon,
  label,
  size = 'tiny',
  variant = 'tertiary',
  disabled,
  reason,
  tabIndex,
  onFocus,
  onClick,
}: {
  icon: LucideIcon
  label: string
  size?: 'tiny' | 'small'
  variant?: 'secondary' | 'tertiary'
  disabled?: boolean
  /** Why it is disabled, said in the tooltip. */
  reason?: string
  tabIndex?: number
  onFocus?: FocusEventHandler<HTMLButtonElement>
  onClick: () => void
}) {
  return (
    <Tooltip text={disabled && reason ? `${label}: ${reason}` : label}>
      <Button svgOnly variant={variant} size={size} aria-label={label} disabled={disabled} tabIndex={tabIndex} onFocus={onFocus} onClick={onClick}>
        <Icon aria-hidden className={size === 'tiny' ? 'size-3.5' : 'size-4'} />
      </Button>
    </Tooltip>
  )
}

/** Where a table row's actions show: always on touch (no hover), else on hover or focus of the row, and while its menu is open. */
export const rowActionsShown = '[@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[menu-open]/row:opacity-100'

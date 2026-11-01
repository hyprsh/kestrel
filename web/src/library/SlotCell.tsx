import { Button, StatusDot } from '@hyprsh/design'
import type { ReactElement } from 'react'
import { usePhone } from '../responsive'
import { faintDot, type Dot } from './bits'
import { CellPopover } from './EpisodeFilePopover'

/** The colour of a cell's text: Wanted amber and downloading blue, as the dots beside them are; the rest plain or quiet. */
const stateText: Record<string, string> = { filled: '', wanted: 'text-amber-900', downloading: 'text-blue-900', unreleased: 'text-gray-900', unmonitored: 'text-gray-900' }

/**
 * A Slot's cell: a status dot and a short line ("1080p · 1.6 GB", "Wanted · 12 d", "40% · 13 min") as one quiet button, its `title` the tooltip.
 * `filePopover` wraps the button in the file popover of a filled cell; without it a phone gets the short state popover of `title`, a desktop the bare button.
 * `state` is the cell's State (null: no Version). `textOnPhone` keeps the line on a phone, where the episode table shows only the dot.
 */
export function SlotCell({
  state,
  dot,
  text,
  title,
  ariaLabel,
  popoverLabel,
  filePopover,
  textOnPhone = false,
  cellId,
  tabIndex,
  onFocus,
}: {
  state: string | null
  dot: Dot
  text: string | null
  title: string
  ariaLabel: string
  popoverLabel: string
  filePopover?: (trigger: ReactElement) => ReactElement
  textOnPhone?: boolean
  cellId?: string
  tabIndex?: number
  onFocus?: () => void
}) {
  const phone = usePhone()
  const button = (
    <Button
      variant="tertiary"
      size="tiny"
      className="max-w-full"
      aria-label={ariaLabel}
      title={title}
      data-cell={cellId}
      tabIndex={tabIndex}
      onFocus={onFocus}
      prefix={<StatusDot state={dot.state} variant={dot.variant} label={false} title={null} aria-hidden className={dot.faint ? faintDot : undefined} />}
    >
      <span className={`min-w-0 truncate ${textOnPhone ? '' : 'max-sm:sr-only'} ${state ? stateText[state] : 'text-gray-900'}`}>{text ?? '—'}</span>
    </Button>
  )
  if (filePopover) return filePopover(button)
  // No hover on a phone: a tap says what the state means.
  return phone ? <CellPopover label={popoverLabel} text={title} trigger={button} /> : button
}

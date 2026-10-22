// A button that opens a menu of actions, built from the design's Menu. What it adds is Kestrel's
// keyboard contract: while the menu is open it owns the keyboard, so a grid or list around it
// (arrows, j/k, Enter, and the pane's Escape) does not also act, and Escape closes the menu and
// puts focus back where it was. The design's list is portalled, but React still bubbles its keys
// through the tree this component sits in.
import { Menu } from '@hyprsh/design'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export function ActionMenu({
  label,
  icon,
  text,
  children,
  className,
  tabIndex,
  size = 'small',
}: {
  /** The button's accessible name, and the menu's. */
  label: string
  /** An icon-only button's icon. */
  icon?: ReactNode
  /** A text button's label, with a chevron. */
  text?: string
  children: ReactNode
  className?: string
  /** -1 keeps the button out of the Tab order, for a grid with a roving focus. */
  tabIndex?: number
  size?: 'tiny' | 'small' | 'medium'
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Where focus was when the menu opened: Escape puts it back there.
  const back = useRef<HTMLElement | null>(null)

  const change = (next: boolean) => {
    if (next) back.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    setOpen(next)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      ;(back.current ?? button.current)?.focus()
    }
  }

  return (
    <span className={className} onKeyDown={onKeyDown}>
      <Menu.Container open={open} onOpenChange={change} position="bottom-end">
        {icon ? (
          <Menu.Button ref={button} svgOnly variant="tertiary" size={size} aria-label={label} tabIndex={tabIndex}>
            {icon}
          </Menu.Button>
        ) : (
          <Menu.Button ref={button} variant="secondary" size={size} aria-label={label} tabIndex={tabIndex} showChevron>
            {text}
          </Menu.Button>
        )}
        <Menu>{children}</Menu>
      </Menu.Container>
    </span>
  )
}

// A menu button: the one popup menu primitive of the SPA (the episode grid's
// row actions, the Title page's "…" menu). The button opens a role=menu list
// with focus on its first item; arrows, Home and End move, Enter or Space runs
// an item, Escape and Tab close it. Escape is handled here, so a list's own
// Escape (clearing a selection, leaving a pane) does not also fire.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './ui'

const CloseMenu = createContext<(refocus: boolean) => void>(() => {})

const items = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

/**
 * A button named `label` that opens the menu of `children` (MenuItems). `trigger`
 * is what the button shows, usually an icon. `buttonTabIndex` lets a grid with
 * a roving focus keep the button out of the Tab order.
 */
export function Menu({
  label,
  trigger,
  children,
  className,
  buttonClassName,
  buttonTabIndex,
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
  className?: string
  buttonClassName?: string
  buttonTabIndex?: number
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Where focus was when the menu opened: it goes back there on close.
  const back = useRef<HTMLElement | null>(null)
  const id = useId()

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) (back.current ?? button.current)?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    items(menu.current)[0]?.focus()
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, close])

  const onKeyDown = (e: KeyboardEvent) => {
    // The menu owns the keyboard while focus is in it: a grid or list around it must not also move.
    e.stopPropagation()
    const all = items(menu.current)
    const at = all.indexOf(document.activeElement as HTMLElement)
    const focus = (i: number) => {
      e.preventDefault()
      all[(i + all.length) % all.length]?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
        return focus(at + 1)
      case 'ArrowUp':
        return focus(at - 1)
      case 'Home':
        return focus(0)
      case 'End':
        return focus(all.length - 1)
      case 'Escape':
        e.preventDefault()
        return close(true)
      case 'Tab':
        return close(false)
    }
  }

  return (
    <span ref={wrap} className={cx('relative inline-flex', className)}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        tabIndex={buttonTabIndex}
        onClick={() => {
          if (!open) back.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
          setOpen(!open)
        }}
        className={cx(
          'inline-flex items-center justify-center rounded text-gray-900 outline-none hover:bg-gray-alpha-200 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700',
          buttonClassName,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute top-full right-0 z-30 mt-1 flex min-w-44 flex-col rounded-md border border-gray-alpha-400 bg-background-100 py-1 text-[13px] shadow-lg"
        >
          <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
        </div>
      )}
    </span>
  )
}

/** One item of a Menu. A disabled item can be focused but not run; `hint` says why it is disabled. */
export function MenuItem({ onSelect, disabled = false, hint, children }: { onSelect: () => void; disabled?: boolean; hint?: string; children: ReactNode }) {
  const close = useContext(CloseMenu)
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      title={hint}
      onClick={() => {
        if (disabled) return
        close(true)
        onSelect()
      }}
      className={cx(
        'px-3 py-1 text-left whitespace-nowrap outline-none focus:bg-gray-alpha-200',
        disabled ? 'cursor-default text-gray-700' : 'hover:bg-gray-alpha-100',
      )}
    >
      {children}
    </button>
  )
}

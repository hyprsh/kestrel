// Keyboard handling shared by every list screen (PRD story 100): j/k and the
// arrow keys move, Enter opens, `/` filters. Ported from the prototype's bits.tsx.
import { useEffect, useRef } from 'react'

/** The shortcut modifier shown in hints: ⌘ on Apple platforms, else Ctrl. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

const typing = 'input, textarea, select, [contenteditable=true]'

/** Whether keystrokes belong to a text field, so single-key shortcuts stay out of the way. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(typing) !== null
}

/** The command menu is open: it owns the keyboard. */
const menuOpen = () => document.querySelector('[data-cmdk]') !== null

/** A single-key shortcut, ignored while typing, with a modifier held or while the command menu is open. */
export function useKey(key: string, fn: (e: KeyboardEvent) => void, enabled = true) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target) || menuOpen()) return
      latest.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, enabled])
}

/** Where a row sits in a `useListNav` list (an Entity row with `current`); a row outside one is a plain list item. */
export type RowNav = { scope: string; index: number; sel: number; onSelect: () => void }

/**
 * Moves a selection through `count` rows with j/ArrowDown and k/ArrowUp
 * (clamped), and calls `onEnter` for Enter unless a button or link has focus.
 * Rows carry data-nav="<scope>-<index>" so the selection can scroll into view.
 */
export function useListNav(scope: string, count: number, sel: number, setSel: (i: number) => void, onEnter?: (i: number) => void, enabled = true) {
  const latest = useRef({ count, sel, setSel, onEnter })
  latest.current = { count, sel, setSel, onEnter }
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || menuOpen()) return
      const { count, sel, setSel, onEnter } = latest.current
      if (count === 0) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSel(Math.min(sel + 1, count - 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSel(Math.max(sel - 1, 0))
      } else if (e.key === 'Enter' && onEnter) {
        if (e.target instanceof Element && e.target.closest('button, a')) return
        e.preventDefault()
        onEnter(sel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  useEffect(() => {
    document.querySelector(`[data-nav="${scope}-${sel}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [scope, sel])
}

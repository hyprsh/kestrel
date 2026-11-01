// chrome: layout
// Column order, the companion of columnWidths.tsx: a table whose columns can be moved follows these rules too.
//
// - Movable columns: every column except the ones that identify the row (the tick box, the episode number and
//   name), which are pinned first and have no handle. The design's Table has no reordering, so the app does it:
//   the table renders its movable columns in `order`, heads and cells alike.
// - Order: `useColumnOrder('<table key>', defaultKeys)` keeps it in local storage under
//   `kestrel.columns.<key>.order`, saved when a move is done. A missing, unreadable or corrupt value means the
//   default; keys that no longer exist are dropped and columns that are new are appended in their default place.
// - Moving: drag a head onto another one with a mouse or pen (`head(key)` gives the props and class of a movable
//   head: `data-column` names it). A touch screen keeps the default order.
// - Reset: `isDefault` is false while the order differs; the screen's reset does `order.reset()` beside the
//   widths' `reset()` (one "Reset columns" action, offered while either differs).
import { useCallback, useRef, useState, type PointerEvent } from 'react'

const prefix = 'kestrel.columns.'
const suffix = '.order'

/** A stored order made safe: only the known keys, each once, then the ones it lacks in their default order. */
export function resolveColumnOrder(stored: unknown, defaults: readonly string[]): string[] {
  const known = new Set(defaults)
  const seen = new Set<string>()
  const order: string[] = []
  if (Array.isArray(stored)) {
    for (const key of stored) {
      if (typeof key === 'string' && known.has(key) && !seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  for (const key of defaults) if (!seen.has(key)) order.push(key)
  return order
}

/** The stored keys as they were saved (not yet checked against a table's columns), or null. */
function readStored(tableKey: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(prefix + tableKey + suffix) ?? 'null')
  } catch {
    // no local storage, or not JSON: the default
    return null
  }
}

function writeStored(tableKey: string, order: string[] | null) {
  try {
    if (order === null) localStorage.removeItem(prefix + tableKey + suffix)
    else localStorage.setItem(prefix + tableKey + suffix, JSON.stringify(order))
  } catch {
    // no local storage: the order lasts until the page is left
  }
}

const dragDistance = 4

/**
 * The order of one table's movable columns, remembered in this browser. `defaults` are the keys now on show in their
 * default order (they may change from one view to the next: a Series has the Slots it has). `head(key)` is what a
 * movable head takes: the `data-column` name, pointer handlers for the drag and a class for the drag's look.
 */
export function useColumnOrder(tableKey: string, defaults: readonly string[]) {
  const [stored, setStored] = useState<unknown>(() => readStored(tableKey))
  const order = resolveColumnOrder(stored, defaults)
  const isDefault = order.every((key, i) => key === defaults[i])
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null)
  const latest = useRef(order)
  latest.current = order

  const place = useCallback(
    (key: string, to: number) => {
      const current = latest.current
      const from = current.indexOf(key)
      if (from < 0 || to < 0 || to >= current.length || to === from) return
      const next = current.filter((k) => k !== key)
      next.splice(to, 0, key)
      setStored(next)
      writeStored(tableKey, next)
    },
    [tableKey],
  )
  const moveBy = useCallback((key: string, delta: number) => place(key, latest.current.indexOf(key) + delta), [place])
  const reset = useCallback(() => {
    setStored(null)
    writeStored(tableKey, null)
  }, [tableKey])

  const onPointerDown = (key: string) => (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return
    const x = e.clientX
    const y = e.clientY
    let started = false
    let over: string | null = null
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      setDrag(null)
    }
    const move = (m: globalThis.PointerEvent) => {
      if (!started && Math.hypot(m.clientX - x, m.clientY - y) < dragDistance) return
      started = true
      const head = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('[data-column]')
      const target = head?.dataset.column ?? null
      over = target && target !== key && latest.current.includes(target) ? target : null
      setDrag({ key, over })
    }
    const up = () => {
      cleanup()
      if (started && over !== null) place(key, latest.current.indexOf(over))
    }
    const cancel = () => cleanup()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  const head = (key: string) => {
    const from = drag ? order.indexOf(drag.key) : -1
    const at = order.indexOf(key)
    const target = drag?.over === key
    return {
      'data-column': key,
      onPointerDown: onPointerDown(key),
      className: [
        'cursor-grab select-none',
        drag?.key === key ? 'opacity-50' : '',
        // The drop side: the dragged column lands where this one is, so the mark is on the side it comes from.
        target ? (from < at ? 'shadow-[inset_-2px_0_0_var(--blue-700)]' : 'shadow-[inset_2px_0_0_var(--blue-700)]') : '',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  return { order, isDefault, moveBy, reset, head }
}

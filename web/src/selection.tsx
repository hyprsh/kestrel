// Multi-select for lists: the Library uses it, and it is built to be shared
// with Adoption (#112) and the episode grid (#127). "Checked" is the selection
// in code and "ticked" in the UI; "selected" stays the list's cursor
// (aria-selected).
import { Button, KeyboardInput } from '@hyprsh/design'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useKey } from './keys'

export type Selection = {
  /** The checked ids, in the order of the list. */
  checked: number[]
  count: number
  has: (id: number) => boolean
  /** Checks or unchecks one id; with `range`, everything from the last one toggled to it takes its new state. */
  toggle: (id: number, opts?: { range?: boolean }) => void
  /** Checks every id the list shows. */
  checkAll: () => void
  clear: () => void
  /** Checkboxes show while this is on or anything is checked. */
  active: boolean
  setActive: (on: boolean) => void
}

/**
 * The checked subset of `ids`, the ids a list shows in its order. Ids that
 * leave the list (filtered out, removed) are unchecked, so the count always
 * matches what is on screen. Escape clears the selection unless something else
 * already handled the key.
 */
export function useSelection(ids: number[]): Selection {
  const [stored, setStored] = useState<ReadonlySet<number>>(() => new Set())
  const [on, setOn] = useState(false)
  const anchor = useRef<number | null>(null)

  const shown = useMemo(() => new Set(ids), [ids])
  useEffect(() => {
    setStored((s) => ([...s].every((id) => shown.has(id)) ? s : new Set([...s].filter((id) => shown.has(id)))))
  }, [shown])

  const checked = useMemo(() => ids.filter((id) => stored.has(id)), [ids, stored])
  const latest = useRef({ ids, stored })
  latest.current = { ids, stored }

  const toggle = useCallback((id: number, { range = false }: { range?: boolean } = {}) => {
    const { ids, stored } = latest.current
    const next = new Set(stored)
    const value = !stored.has(id)
    const from = anchor.current === null ? -1 : ids.indexOf(anchor.current)
    const to = ids.indexOf(id)
    const span = range && from !== -1 && to !== -1 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
    for (const x of span) {
      if (value) next.add(x)
      else next.delete(x)
    }
    anchor.current = id
    setStored(next)
  }, [])
  const clear = useCallback(() => {
    anchor.current = null
    setStored(new Set())
    setOn(false)
  }, [])
  const checkAll = useCallback(() => setStored(new Set(latest.current.ids)), [])

  useKey(
    'Escape',
    (e) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      clear()
    },
    checked.length > 0 || on,
  )

  return {
    checked,
    count: checked.length,
    has: (id) => stored.has(id),
    toggle,
    checkAll,
    clear,
    active: on || checked.length > 0,
    setActive: setOn,
  }
}

/** The count of ticked rows, "Tick all N shown" and Clear, with the actions for the selection beside them. */
export function SelectionBar({ selection, shown, children }: { selection: Selection; shown: number; children?: ReactNode }) {
  if (!selection.active) return null
  return (
    <div role="group" aria-label="Selection" className="flex flex-wrap items-center gap-2 copy-13">
      <span className="label-13">{selection.count} ticked</span>
      {selection.count < shown && (
        <Button variant="tertiary" size="small" onClick={selection.checkAll}>
          Tick all {shown} shown
        </Button>
      )}
      <Button variant="tertiary" size="small" onClick={selection.clear} suffix={<KeyboardInput small>Esc</KeyboardInput>}>
        Clear
      </Button>
      {children}
    </div>
  )
}

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
  /** How many are checked: every row of the filter, shown or not, while `all` is on. */
  count: number
  /** "Every row in this filter" is checked, including the ones not loaded yet; a bulk action then names the filter, not ids. */
  all: boolean
  has: (id: number) => boolean
  /** Checks or unchecks one id; with `range`, everything from the last one toggled to it takes its new state. */
  toggle: (id: number, opts?: { range?: boolean }) => void
  /** Checks every id the list shows. */
  checkAll: () => void
  /** Checks every row of the filter, the pages not loaded included (a list that pages passes `total`). */
  checkMatching: () => void
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
 *
 * A list that pages passes `total`, the rows its filter keeps: `checkMatching` then checks all of them
 * (`all`), and the caller sends the filter instead of ids.
 */
export function useSelection(ids: number[], total?: number): Selection {
  const [stored, setStored] = useState<ReadonlySet<number>>(() => new Set())
  const [every, setEvery] = useState(false)
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
    setEvery(false)
    setStored(next)
  }, [])
  const clear = useCallback(() => {
    anchor.current = null
    setStored(new Set())
    setEvery(false)
    setOn(false)
  }, [])
  const checkAll = useCallback(() => {
    setEvery(false)
    setStored(new Set(latest.current.ids))
  }, [])
  const checkMatching = useCallback(() => {
    setEvery(true)
    setStored(new Set(latest.current.ids))
  }, [])

  useKey(
    'Escape',
    (e) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      clear()
    },
    checked.length > 0 || on,
  )

  const all = every && total !== undefined
  return {
    checked,
    count: all ? total : checked.length,
    all,
    has: (id) => all || stored.has(id),
    toggle,
    checkAll,
    checkMatching,
    clear,
    active: on || checked.length > 0,
    setActive: setOn,
  }
}

/**
 * The count of ticked rows, "Tick all N shown" and Clear, with the actions for the selection beside them.
 * A list that pages passes `total` for "Tick all N in this filter"; `verb` words it for lists where
 * "ticked" already means something else (Adoption's rows are selected, then adopted).
 */
export function SelectionBar({
  selection,
  shown,
  total,
  verb = 'tick',
  children,
}: {
  selection: Selection
  shown: number
  total?: number
  verb?: 'tick' | 'select'
  children?: ReactNode
}) {
  if (!selection.active) return null
  const did = verb === 'tick' ? 'ticked' : 'selected'
  const Do = verb === 'tick' ? 'Tick' : 'Select'
  return (
    <div role="group" aria-label="Selection" className="flex flex-wrap items-center gap-2 copy-13">
      <span className="label-13">
        {selection.count} {did}
      </span>
      {!selection.all && selection.count < shown && (
        <Button variant="tertiary" size="small" onClick={selection.checkAll}>
          {Do} all {shown} shown
        </Button>
      )}
      {!selection.all && total !== undefined && total > shown && (
        <Button variant="tertiary" size="small" onClick={selection.checkMatching}>
          {Do} all {total} in this filter
        </Button>
      )}
      <Button variant="tertiary" size="small" onClick={selection.clear} suffix={<KeyboardInput small>Esc</KeyboardInput>}>
        Clear
      </Button>
      {children}
    </div>
  )
}

// chrome: layout
import { Button, KeyboardInput } from '@hyprsh/design'
import type { ReactNode } from 'react'
import type { Selection } from '../selection'

/**
 * The count of ticked rows, "Tick all N shown" and Clear, with the actions for the selection beside them.
 * A list that pages passes `total` for "Tick all N in this filter"; `verb` words it for lists where
 * "ticked" already means something else (Adoption's rows are selected, then adopted). `always` shows the bar, with
 * its select-all controls, before anything is checked; the actions in `children` and Clear wait for a selection.
 */
export function SelectionBar({
  selection,
  shown,
  total,
  verb = 'tick',
  always = false,
  children,
}: {
  selection: Selection
  shown: number
  total?: number
  verb?: 'tick' | 'select'
  always?: boolean
  children?: ReactNode
}) {
  if (!selection.active && !always) return null
  const did = verb === 'tick' ? 'ticked' : 'selected'
  const Do = verb === 'tick' ? 'Tick' : 'Select'
  return (
    <div role="group" aria-label="Selection" className="flex flex-wrap items-center gap-2 copy-13">
      {selection.active && (
        <span className="label-13">
          {selection.count} {did}
        </span>
      )}
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
      {selection.narrowed && total !== undefined && <span>No longer all {total} in this filter</span>}
      {selection.active && (
        <Button variant="tertiary" size="small" onClick={selection.clear} suffix={<KeyboardInput small>Esc</KeyboardInput>}>
          Clear
        </Button>
      )}
      {selection.active && children}
    </div>
  )
}

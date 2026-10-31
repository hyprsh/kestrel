// A row's tick box: the design's Checkbox, wired to a useSelection. Shift-click ticks a range, and
// clicking it never moves the list's cursor or opens the row. `cell`, `tabIndex` and `onFocus` make it a
// cell of a grid with a roving focus (the episode table's first column).
import { Checkbox } from '@hyprsh/design'
import type { Selection } from '../selection'

export function TickBox({
  selection,
  id,
  name,
  verb = 'Tick',
  cell,
  tabIndex,
  onFocus,
}: {
  selection: Selection
  id: number
  name: string
  verb?: 'Tick' | 'Select'
  cell?: string
  tabIndex?: number
  onFocus?: () => void
}) {
  return (
    <span className="inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        aria-label={`${verb} ${name}`}
        data-tick=""
        data-cell={cell}
        tabIndex={tabIndex}
        onFocus={onFocus}
        checked={selection.has(id)}
        onClick={(e) => selection.toggle(id, { range: e.shiftKey })}
      />
    </span>
  )
}

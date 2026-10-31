// A row's tick box: the design's Checkbox, wired to a useSelection. Shift-click ticks a range, and
// clicking it never moves the list's cursor or opens the row. A list that is one Tab stop (a cursor
// listbox, where x ticks) passes tabIndex -1 so the boxes stay out of the Tab order.
import { Checkbox } from '@hyprsh/design'
import type { Selection } from '../selection'

export function TickBox({ selection, id, name, verb = 'Tick', tabIndex }: { selection: Selection; id: number; name: string; verb?: 'Tick' | 'Select'; tabIndex?: number }) {
  return (
    <span className="inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <Checkbox aria-label={`${verb} ${name}`} data-tick="" tabIndex={tabIndex} checked={selection.has(id)} onClick={(e) => selection.toggle(id, { range: e.shiftKey })} />
    </span>
  )
}

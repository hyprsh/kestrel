// chrome: domain-visual
// The accordion the Title page uses for a Series' seasons and a Movie's Slots: a bordered list of rows, each a row that opens
// its body in place. A row is a grid with a click overlay (the whole row toggles) under its own controls, so a bookmark or a
// chip inside it stays a real button of its own.
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/** The bordered list the rows sit in. */
export function AccordionList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="list" aria-label={label} className="overflow-hidden rounded-md shadow-border">
      {children}
    </div>
  )
}

/** The chevron that turns when its row is open. */
export function Chevron({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={`size-4 shrink-0 text-gray-900 transition-transform ${open ? 'rotate-90' : ''}`} />
}

/**
 * One row of the accordion: `header` is its grid (chevron first), `body` what shows while it is open. The overlay button is
 * named `label` and says whether the row is open; `marked` rings the row (the Slot a page was opened at).
 */
export function AccordionRow({
  id,
  label,
  open,
  onToggle,
  header,
  body,
  gridClass,
  marked,
  mark,
  itemLabel,
}: {
  id?: string
  label: string
  open: boolean
  onToggle: () => void
  header: ReactNode
  body?: ReactNode
  /** The header's grid columns, per layout. */
  gridClass: string
  marked?: boolean
  mark?: string
  /** Names the row's list item (a Slot's name), so tests and screen readers find the row apart from its button. */
  itemLabel?: string
}) {
  return (
    <div
      role="listitem"
      aria-label={itemLabel}
      id={id}
      data-open={open ? '' : undefined}
      data-current={marked ? '' : undefined}
      data-mark={mark}
      className={`border-b border-gray-alpha-200 last:border-b-0 ${marked ? 'ring-2 ring-blue-700 ring-inset' : ''}`}
    >
      <div className={`relative grid items-center gap-x-3 px-3.5 hover:bg-background-200 max-sm:px-3 ${open ? 'bg-background-200' : ''} ${gridClass}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={label}
          onClick={onToggle}
          className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-color)"
        />
        {header}
      </div>
      {open && body}
    </div>
  )
}

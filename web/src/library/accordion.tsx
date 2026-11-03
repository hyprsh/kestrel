// chrome: domain-visual
// The accordion the Title page uses for a Series' seasons and a Movie's Slots: a bordered list of rows, each a row that opens
// its body in place. A closed or open row is one 48 px line (`lineRow`; a phone gets the two-line `phoneRow`) with a click
// overlay (the whole row toggles) under its own controls, so a bookmark or a chip inside it stays a real button of its own.
// The cells the three accordions share sit here: the name with its tag, the state text, the fixed 120 px bar, the count and the size.
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { plural } from '../format'
import type { TitleDetail } from '../api/queries'
import { foundText } from './WantedLine'

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
 * One row of the accordion: `header` is its cells (chevron first), `body` what shows while it is open. The overlay button is
 * named `label` and says whether the row is open; `marked` rings the row (the Slot a page was opened at).
 */
export function AccordionRow({
  id,
  label,
  open,
  onToggle,
  header,
  body,
  rowClass,
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
  /** The header's layout: `lineRow` on a wide screen, `phoneRow` on a phone. */
  rowClass: string
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
      <div className={`relative items-center gap-x-3 px-3.5 hover:bg-background-200 max-sm:px-3 ${open ? 'bg-background-200' : ''} ${rowClass}`}>
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

/** A row on a wide screen: one 48 px line, everything centred on it. */
export const lineRow = 'flex h-12'
/** A row on a phone: the name and size on a line, the state text, bar and count under it. */
export const phoneRow = 'grid min-h-14 grid-cols-[16px_minmax(0,1fr)_auto] py-2.5'

/** A row's name with what goes beside it: a Profile as a small mono tag, or a season's meta as plain text. */
export function RowName({ name, tag, meta, dim }: { name: string; tag?: string; meta?: string; dim?: boolean }) {
  return (
    <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
      <span className={`label-14 shrink-0 font-semibold ${dim ? 'text-gray-900' : ''}`}>{name}</span>
      {tag && <span className="label-12-mono truncate rounded-sm bg-gray-100 px-1.5 text-gray-900">{tag}</span>}
      {meta && <span className="label-13 truncate text-gray-900">{meta}</span>}
    </span>
  )
}

/** A row's state text ("Complete", "2 Wanted"), in its tone. */
export function StandingText({ text, tone, className = '' }: { text: string; tone: string; className?: string }) {
  return <span className={`label-12 pointer-events-none min-w-0 truncate ${tone} ${className}`}>{text}</span>
}

/** The bar's cell: 120 px wide whatever the row, so the bars line up down the list. */
export function BarCell({ children, className = 'w-[120px]' }: { children?: ReactNode; className?: string }) {
  return <span className={`pointer-events-none shrink-0 ${className}`}>{children}</span>
}

/** The count's cell, as wide as the chips column so counts and chips line up. `relative` keeps a chip's button above the row's overlay. */
export function CountCell({ children }: { children?: ReactNode }) {
  return <span className="relative flex w-(--chips) shrink-0 items-center gap-[5px]">{children}</span>
}

/** A count as mono text with tabular numbers: "39/39". */
export function Count({ text, tip }: { text: string; tip: string }) {
  return (
    <span role="img" aria-label={tip} title={tip} className="label-12-mono pointer-events-none whitespace-nowrap text-gray-900 tabular-nums">
      {text}
    </span>
  )
}

/** The size, right-aligned in a fixed 64 px column so sizes line up across rows. */
export function SizeCell({ text }: { text: string }) {
  return <span className="label-13 pointer-events-none w-16 shrink-0 text-right text-gray-900 tabular-nums">{text}</span>
}

/** The padding and rule of an open row's body. */
export const bodyWrap = 'flex flex-col gap-3 border-t border-gray-alpha-200 bg-background-100 py-3.5 pr-3.5 pl-[46px] max-sm:pl-3'
/** The grid of an open row's facts. */
export const factsGrid = 'grid grid-cols-4 gap-3 max-sm:grid-cols-2'

/** A fact of an open row: a small label over its value. */
export function Fact({ k, children, wide, full }: { k: string; children: ReactNode; wide?: boolean; /** Spans every column of the grid. */ full?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${full ? 'col-span-full' : wide ? 'col-span-2 max-sm:col-span-1' : ''}`}>
      <span className="label-12 text-gray-900">{k}</span>
      <span className="label-13 min-w-0 break-words">{children}</span>
    </div>
  )
}

/** Whole days since an instant (0 when there is none). */
export const days = (since: string | null, now: number) => (since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000)) : 0)

/** What the last search came to, in a few words: "23 releases", "37 releases, grabbed one", "no indexer is turned on". */
export function lastSearchWords(ls: NonNullable<TitleDetail['versions'][number]['last_search']>): string {
  if (ls.outcome === 'grabbed') return `${plural(ls.releases, 'release')}, grabbed one`
  return ls.releases === 0 || ls.outcome === 'no_indexer' || ls.outcome === 'error' ? foundText(ls) : plural(ls.releases, 'release')
}

// chrome: domain-visual
// The Overview's chart marks in plain React: stacked columns (Grabs per day, the download client's speed), a bar list
// (indexers, release groups) and a segmented bar (Library quality). They follow the dataviz rules: thin marks, a 2px gap
// between touching marks, a 4px rounded data end on a square baseline, a legend for two or more series, status colours only
// for status, text in text tokens, and a tooltip on every mark that shows on hover and on keyboard focus. Every chart also
// has a text alternative: a summary in its label and a table for screen readers, so nothing is only in a tooltip.
import { Tooltip } from '@hyprsh/design'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

/** The colour classes of the marks. Green and red are status (imported, failed); blue is the one hue for everything else. */
export const mark = {
  imported: 'bg-green-700',
  failed: 'bg-red-700',
  blue: 'bg-blue-700',
  quality: ['bg-blue-900', 'bg-blue-600', 'bg-blue-300'],
} as const

/** A legend swatch: the mark's colour beside text in the text token. */
export function Swatch({ className, round }: { className: string; round?: boolean }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 ${round ? 'rounded-full' : 'rounded-xs'} ${className}`} />
}

export function Legend({ items }: { items: { label: string; className: string; value?: string }[] }) {
  return (
    <span className="label-12 inline-flex flex-wrap gap-x-3 gap-y-1 text-gray-900">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch className={i.className} />
          {i.label}
          {i.value !== undefined && <span className="tabular-nums">{i.value}</span>}
        </span>
      ))}
    </span>
  )
}

/** Screen readers' twin of a chart: its rows as a table, hidden from sight. */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Axis ticks for a column chart: 0 and clean numbers up to the first one at or past `max` (1, 2, 5 or 10 times a power of ten). */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const pow = 10 ** Math.floor(Math.log10(max))
  const top = [1, 2, 5, 10].map((m) => m * pow).find((t) => t >= max) ?? max
  const mid = top / 2
  return Number.isInteger(mid) && top >= 4 ? [0, mid, top] : [0, top]
}

export type Part = { name: string; className: string; n: number }
export type Column = {
  key: string
  /** The column's name in the tooltip and its label: "Oct 18". */
  title: string
  parts: Part[]
}

const sum = (c: Column) => c.parts.reduce((t, p) => t + p.n, 0)

/**
 * Stacked columns on one baseline. Each column is its own hit target (the whole height, gap included): hovering or focusing it
 * shows a tooltip with every part, and arrow keys move between columns. `format` writes a part's value; `alternative` is the
 * chart's summary for screen readers; `axis` labels the first, middle and last column.
 */
export function Columns({
  columns,
  height,
  alternative,
  format = (n) => String(n),
  axis,
  ticks = true,
  scaleMax,
}: {
  columns: Column[]
  height: number
  alternative: string
  format?: (n: number, part: Part) => string
  axis?: [string, string, string]
  /** Gridlines and numbers on the left at clean values. */
  ticks?: boolean
  /** The value the full height stands for; the largest column when omitted. */
  scaleMax?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState(Math.max(columns.length - 1, 0))
  const top = Math.max(1, ...columns.map(sum))
  const tickValues = ticks ? niceTicks(scaleMax ?? top) : []
  const max = scaleMax ?? (ticks ? tickValues[tickValues.length - 1] : top)
  const px = (n: number) => (n <= 0 ? 0 : Math.max(3, Math.round((n / max) * height)))
  const move = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null || next < 0 || next >= columns.length) return
    e.preventDefault()
    setFocus(next)
    ;(e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
  }
  const shown = hover === null ? null : columns[hover]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mt-2 flex gap-2">
        {ticks && (
          <div aria-hidden className="label-12 relative w-6 shrink-0 text-right text-gray-900 tabular-nums" style={{ height }}>
            {tickValues.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2 leading-none" style={{ bottom: (t / max) * height }}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          {tickValues.slice(1).map((t) => (
            <div key={t} aria-hidden className="absolute inset-x-0 border-t border-gray-alpha-300" style={{ bottom: (t / max) * height }} />
          ))}
          <div role="group" aria-label={alternative} className="relative flex items-end gap-0.5 border-b border-gray-alpha-400" style={{ height }} onPointerLeave={() => setHover(null)}>
            {columns.map((c, i) => (
              <button
                key={c.key}
                type="button"
                tabIndex={i === focus ? 0 : -1}
                aria-label={`${c.title}: ${c.parts.map((p) => `${format(p.n, p)} ${p.name.toLowerCase()}`).join(', ')}`}
                className={`flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-t-sm border-0 px-px py-0 outline-offset-2 ${hover === i ? 'bg-gray-alpha-200' : 'bg-transparent'}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => {
                  setHover(i)
                  setFocus(i)
                }}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => move(e, i)}
              >
                <span className="flex w-full max-w-6 flex-col-reverse gap-0.5">
                  {c.parts
                    .filter((p) => p.n > 0)
                    .map((p, k, drawn) => (
                      <span key={p.name} aria-hidden className={`block ${p.className}`} style={{ height: px(p.n), borderRadius: k === drawn.length - 1 ? '4px 4px 0 0' : 0 }} />
                    ))}
                </span>
              </button>
            ))}
          </div>
          {shown && hover !== null && (
            <div
              role="tooltip"
              className="label-12 pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-background-100 px-2.5 py-1.5 whitespace-nowrap shadow-border-medium"
              style={{ left: `clamp(70px, ${((hover + 0.5) / columns.length) * 100}%, calc(100% - 70px))` }}
            >
              <div className="text-gray-900">{shown.title}</div>
              {shown.parts.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span aria-hidden className={`inline-block h-0.5 w-3 ${p.className}`} />
                  <b className="text-gray-1000 tabular-nums">{format(p.n, p)}</b>
                  <span className="text-gray-900">{p.name.toLowerCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {axis && (
        <div aria-hidden className={`label-12 flex justify-between text-gray-900 ${ticks ? 'pl-8' : ''}`}>
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
          <span>{axis[2]}</span>
        </div>
      )}
    </div>
  )
}

/**
 * One row of a bar list. The row is the hit target: hovering or focusing it shows `label` in a tooltip, and a screen reader
 * reads the same sentence as the row's name (its cells are hidden from it; the chart's table twin lists them). The row lays
 * its `children` out in `columns`, a CSS grid template, with the bar among them (see Bar).
 */
export function BarRow({ columns, label, children }: { columns: string; label: string; children: ReactNode }) {
  return (
    <Tooltip text={label} position="top" boxAlign="left" className="flex w-full min-w-0">
      <div
        tabIndex={0}
        role="group"
        aria-label={label}
        className="grid w-full items-center gap-x-3 border-b border-gray-alpha-200 py-1.5 outline-offset-2 last:border-b-0"
        style={{ gridTemplateColumns: columns }}
      >
        <span aria-hidden className="contents">
          {children}
        </span>
      </div>
    </Tooltip>
  )
}

/** The column titles over a bar list, in the same `columns` as its rows; decoration (each row names its own cells). */
export function BarHeader({ columns, children }: { columns: string; children: ReactNode }) {
  return (
    <div aria-hidden className="label-12 grid items-center gap-x-3 border-b border-gray-alpha-300 pb-1.5 text-gray-900" style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  )
}

/** The bar of a bar list: `share` (0 to 1) of the cell, a 4px rounded tip and a square start, with its figure after the tip. */
export function Bar({ share, figure, className = mark.blue }: { share: number; figure: string; className?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={`block h-2 shrink-0 ${className}`} style={{ width: `calc((100% - 2.25rem) * ${Math.max(share, 0)})`, minWidth: share > 0 ? 3 : 0, borderRadius: '0 4px 4px 0' }} />
      <span className="label-12 tabular-nums">{figure}</span>
    </span>
  )
}

export type Slice = { name: string; className: string; n: number }

/**
 * A thin segmented bar: one whole split into parts with widths in proportion, 2px apart, fully rounded ends and no text on it. A
 * part at zero draws nothing. Each part is a hover and focus target with its name, amount and share; the label carries the same.
 */
export function SegmentedBar({ parts, alternative }: { parts: Slice[]; alternative: string }) {
  const [at, setAt] = useState<number | null>(null)
  const drawn = parts.filter((p) => p.n > 0)
  const total = drawn.reduce((t, p) => t + p.n, 0)
  const before = (i: number) => drawn.slice(0, i).reduce((t, p) => t + p.n, 0)
  const shown = at === null ? null : drawn[at]
  return (
    <div className="relative" onPointerLeave={() => setAt(null)}>
      <div role="group" aria-label={alternative} className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {drawn.map((p, i) => (
          <span
            key={p.name}
            tabIndex={0}
            aria-label={`${p.name}: ${p.n} (${Math.round((p.n / total) * 100)}%)`}
            className={`block h-full outline-offset-2 ${p.className} ${at === i ? 'opacity-80' : ''}`}
            style={{ flex: `${p.n} 1 0`, minWidth: 4 }}
            onPointerEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
          />
        ))}
      </div>
      {shown && at !== null && (
        <div
          role="tooltip"
          className="label-12 pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-background-100 px-2.5 py-1.5 whitespace-nowrap shadow-border-medium"
          style={{ left: `clamp(70px, ${((before(at) + shown.n / 2) / total) * 100}%, calc(100% - 70px))` }}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className={`inline-block h-0.5 w-3 ${shown.className}`} />
            <b className="text-gray-1000 tabular-nums">{shown.n}</b>
            <span className="text-gray-900">{`${shown.name} · ${Math.round((shown.n / total) * 100)}%`}</span>
          </div>
        </div>
      )}
    </div>
  )
}

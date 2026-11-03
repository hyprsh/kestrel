// chrome: domain-visual
// The Overview's chart marks the design system lacks, in plain React: a segmented bar (Library quality). Grabs per day, the
// download client's speed, Indexers and the release groups use the design's ColumnChart and BarList. They follow the dataviz rules: thin marks, a 2px gap
// between touching marks, a 4px rounded data end on a square baseline, a legend for two or more series, status colours only
// for status, text in text tokens, and a tooltip on every mark that shows on hover and on keyboard focus. Every chart also
// has a text alternative: a summary in its label and a table for screen readers, so nothing is only in a tooltip.
import { useState, type ReactNode } from 'react'

/**
 * The colour classes of the marks, as the design's chart tokens: imported and failed take the success and error tones (as ColumnChart
 * does), one series takes `chart-series`, and Library quality takes the `chart-seq` ramp from its darkest (best) step.
 */
export const mark = {
  imported: 'bg-[var(--green-700)]',
  failed: 'bg-[var(--red-800)]',
  blue: 'bg-[var(--chart-series)]',
  quality: ['bg-[var(--chart-seq-5)]', 'bg-[var(--chart-seq-3)]', 'bg-[var(--chart-seq-1)]'],
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

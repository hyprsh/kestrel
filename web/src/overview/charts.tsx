// chrome: domain-visual
// The Overview's chart parts the design system lacks, in plain React: the legend, swatch and screen-reader table. Grabs per day, the
// download client's speed, Indexers and the release groups use the design's ColumnChart and BarList. They follow the dataviz rules: thin marks, a 2px gap
// between touching marks, a 4px rounded data end on a square baseline, a legend for two or more series, status colours only
// for status, text in text tokens, and a tooltip on every mark that shows on hover and on keyboard focus. Every chart also
// has a text alternative: a summary in its label and a table for screen readers, so nothing is only in a tooltip.
import type { ReactNode } from 'react'

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

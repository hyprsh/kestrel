// chrome: domain-visual
// The Library's poster grid: six posters a row on a wide screen, each with its Slot dots on a chip in a corner, a
// badge for Long Missing or a download's progress, the title and the state line. It is a cursor listbox like the list:
// j/k move through the posters, Enter (or a click) picks one, and x ticks it. The marks over a poster are drawn here,
// on the poster frame, which no design component covers.
import { Badge } from '@hyprsh/design'
import type { RefObject } from 'react'
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { PosterSkeleton, TitlePoster } from '../poster'
import type { Selection } from '../selection'
import { cx } from '../ui'
import { SlotDots } from './bits'
import { posterBadge, shownSlots, stateLine, toneText } from './rowState'
import { TickBox } from './TickBox'

export function TitleGrid({
  rows,
  index,
  loading,
  grabs,
  now,
  selection,
  phone,
  gridRef,
  onPick,
}: {
  rows: TitleRow[]
  index: number
  loading: boolean
  grabs: Map<number, QueueItem[]>
  now: number
  selection: Selection
  phone: boolean
  gridRef: RefObject<HTMLDivElement | null>
  onPick: (row: TitleRow) => void
}) {
  return (
    <div ref={gridRef} className={cx('@container min-h-0 flex-1 overflow-auto px-6 pt-4 max-sm:px-4', selection.count > 0 ? 'pb-24' : 'pb-6')}>
      <ul
        // chrome-ok: a cursor listbox (aria-activedescendant) over poster cards, as the list is; Select and Combobox are pickers
        role="listbox"
        aria-label="Library"
        aria-busy={loading || undefined}
        aria-activedescendant={rows[index] ? `title-${rows[index].id}` : undefined}
        tabIndex={0}
        className="grid grid-cols-3 gap-x-4 gap-y-5 p-1 outline-none @xl:grid-cols-4 @3xl:grid-cols-5 @4xl:grid-cols-6"
        onClick={(e) => {
          const id = (e.target as Element).closest('[role="option"]')?.id
          const r = rows.find((x) => `title-${x.id}` === id)
          if (r) onPick(r)
        }}
      >
        {loading &&
          Array.from({ length: 12 }, (_, i) => (
            <li key={i} aria-hidden className="flex flex-col gap-1.5">
              <PosterSkeleton size="fill" />
            </li>
          ))}
        {rows.map((r, i) => {
          const g = grabs.get(r.id) ?? []
          const line = stateLine(r, g, now, { size: true })
          const badge = posterBadge(r, g)
          const current = i === index && !phone
          return (
            <li
              key={r.id}
              id={`title-${r.id}`}
              // chrome-ok: a card of the cursor listbox above; Select and Combobox are pickers
              role="option"
              aria-selected={i === index}
              aria-current={current || undefined}
              data-nav={`lib-${i}`}
              className="flex min-w-0 cursor-pointer flex-col gap-1.5"
            >
              <span
                className={cx(
                  'relative block rounded-md',
                  current ? 'ring-2 ring-gray-1000 ring-offset-2 ring-offset-background-100' : selection.has(r.id) ? 'ring-2 ring-accent-700 ring-offset-2 ring-offset-background-100' : '',
                )}
              >
                <TitlePoster id={r.id} hasPoster={r.has_poster} size="fill" />
                {(selection.active || selection.has(r.id)) && (
                  <span className="absolute top-1.5 left-1.5 flex rounded-sm bg-background-100">
                    <TickBox selection={selection} id={r.id} name={r.title} tabIndex={-1} />
                  </span>
                )}
                {badge && (
                  <span className="absolute top-1.5 right-1.5">
                    <Badge variant={badge.tone === 'error' ? 'red' : 'blue'} size="sm">
                      {badge.label}
                    </Badge>
                  </span>
                )}
                <span className="absolute bottom-1.5 left-1.5 flex rounded-full bg-background-100 px-1.5 py-1 shadow-border">
                  <SlotDots slots={shownSlots(r, g)} />
                </span>
              </span>
              <span className="label-13 truncate">
                <span data-title>{r.title}</span>
                {r.year ? <span className="sr-only"> {r.year}</span> : null}
              </span>
              <span data-state-line className={cx('label-12 -mt-1 truncate', toneText[line.tone])}>
                {line.text}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

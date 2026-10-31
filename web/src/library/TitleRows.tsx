// The Library's list: a cursor listbox of rich rows. A row has its tick box, the poster, the title and year, a line
// saying why the Title is in its state (toned by it), the Slot dots and the size on disk.
import { Entity } from '@hyprsh/design'
import type { RefObject } from 'react'
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { SkeletonRow } from '../loading'
import { TitlePoster } from '../poster'
import type { Selection } from '../selection'
import { KindIcon, size, SlotDots } from './bits'
import { shownSlots, stateLine, toneText } from './rowState'
import { TickBox } from './TickBox'

export function TitleRows({
  rows,
  index,
  loading,
  grabs,
  now,
  selection,
  ticks,
  phone,
  listRef,
  onPick,
}: {
  rows: TitleRow[]
  /** The cursor's row. */
  index: number
  loading: boolean
  grabs: Map<number, QueueItem[]>
  now: number
  selection: Selection
  /** Whether the rows show their tick boxes. */
  ticks: boolean
  phone: boolean
  /** The scroller, which holds the listbox (EntityList takes no ref). */
  listRef: RefObject<HTMLDivElement | null>
  onPick: (row: TitleRow) => void
}) {
  return (
    // The floating bar of ticked Titles covers the foot of the list: room for it at the end.
    <div ref={listRef} className={`min-h-0 flex-1 overflow-auto p-1.5 ${selection.count > 0 ? 'pb-20' : ''}`}>
      <Entity.List
        // chrome-ok: a cursor listbox (aria-activedescendant) over Entity rows; no design component is one, Select and Combobox are pickers
        role="listbox"
        aria-label="Library"
        aria-busy={loading || undefined}
        aria-activedescendant={rows[index] ? `title-${rows[index].id}` : undefined}
        tabIndex={0}
        className="outline-none"
        onClick={(e) => {
          // One handler for the listbox: rows are plain options, so Tab has one stop and aria-activedescendant stays valid.
          const id = (e.target as Element).closest('[role="option"]')?.id
          const r = rows.find((x) => `title-${x.id}` === id)
          if (r) onPick(r)
        }}
      >
        {loading && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} index={i} poster={phone ? 'md' : 'sm'} />)}
        {rows.map((r, i) => {
          const g = grabs.get(r.id) ?? []
          const line = stateLine(r, g, now)
          return (
            <Entity
              key={r.id}
              as="li"
              id={`title-${r.id}`}
              // chrome-ok: a row of the cursor listbox above; Select and Combobox are pickers
              role="option"
              aria-selected={i === index}
              current={i === index && !phone}
              data-nav={`lib-${i}`}
              className={phone ? 'min-h-16' : undefined}
              left={
                <>
                  {ticks && <TickBox selection={selection} id={r.id} name={r.title} tabIndex={-1} />}
                  <TitlePoster id={r.id} hasPoster={r.has_poster} size={phone ? 'md' : 'sm'} />
                </>
              }
              right={
                <span className="flex flex-col items-end gap-1.5">
                  <span className="flex items-center gap-1.5">
                    <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
                    <SlotDots slots={shownSlots(r, g)} />
                  </span>
                  {!phone && <span className="label-12 text-gray-900 tabular-nums">{r.size > 0 ? size(r.size) : '—'}</span>}
                </span>
              }
            >
              <Entity.Content
                fill
                title={
                  <span className="block truncate">
                    <span data-title>{r.title}</span>
                    {r.year ? <span className="ml-1.5 font-normal text-gray-900">{r.year}</span> : null}
                  </span>
                }
                description={
                  <span data-state-line className={`block truncate ${toneText[line.tone]}`}>
                    {line.text}
                  </span>
                }
              />
            </Entity>
          )
        })}
      </Entity.List>
    </div>
  )
}

// chrome: domain-visual
// The Library's list: a cursor listbox of rich rows. A row has its tick box, the poster, the title and year, a line
// saying why the Title is in its state (toned by it), a chip per Slot and the size on disk.
import { Entity } from '@hyprsh/design'
import type { ReactNode, RefObject } from 'react'
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { SkeletonRow } from '../loading'
import { TitlePoster } from '../poster'
import type { Selection } from '../selection'
import { KindIcon, size } from './bits'
import { isMonitoredRow, stateLine, toneText } from './rowState'
import { rowChips } from './rowChips'
import { SlotChips } from './SlotChip'
import { MonitorMark } from './MonitorToggle'
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
  lead,
  navOffset = 0,
  activeId,
  single = false,
  profileName,
  onOpenSlot,
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
  /** Rows above the Titles in the same listbox (the Episode and Season results of the filter). */
  lead?: ReactNode
  /** How many options come before the Titles, so `data-nav` numbers keep running. */
  navOffset?: number
  /** The cursor's option when it is on one of the `lead` rows. */
  activeId?: string
  /** Whether no Title in the Library has more than one Slot: the chips then drop the Slot name. */
  single?: boolean
  profileName?: (key: string) => string
  /** Opens the Title at one of its Slots (a chip's popover and the "+N" list go there). */
  onOpenSlot?: (row: TitleRow, slot: string) => void
}) {
  return (
    // The floating bar of ticked Titles covers the foot of the list: room for it at the end.
    <div ref={listRef} className={`min-h-0 flex-1 overflow-auto p-1.5 ${selection.count > 0 ? 'pb-20' : ''}`}>
      <Entity.List
        // chrome-ok: a cursor listbox (aria-activedescendant) over Entity rows; no design component is one, Select and Combobox are pickers
        role="listbox"
        aria-label="Library"
        aria-busy={loading || undefined}
        aria-activedescendant={activeId ?? (rows[index] ? `title-${rows[index].id}` : undefined)}
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
        {lead}
        {rows.map((r, i) => {
          const g = grabs.get(r.id) ?? []
          const line = stateLine(r, g, now)
          const monitored = isMonitoredRow(r)
          const chips = (
            <SlotChips
              chips={rowChips(r, g, { single, profileName, now, onOpen: onOpenSlot && ((slot) => onOpenSlot(r, slot)) })}
              max={phone ? 3 : 4}
              wrap
              align="start"
              tabIndex={-1}
              label={`${r.title} Slots`}
            />
          )
          // Unmonitored rows dim their chips with the poster.
          const dimmed = monitored ? 'contents' : 'opacity-60'
          return (
            <Entity
              key={r.id}
              as="li"
              id={`title-${r.id}`}
              // chrome-ok: a row of the cursor listbox above; Select and Combobox are pickers
              role="option"
              aria-selected={i === index}
              current={i === index && !phone}
              data-nav={`lib-${i + navOffset}`}
              data-monitored={monitored ? 'on' : 'off'}
              className={`${phone ? 'min-h-16' : ''} ${monitored ? '' : 'bg-background-200'}`}
              left={
                <>
                  {ticks && <TickBox selection={selection} id={r.id} name={r.title} tabIndex={-1} />}
                  <span className={monitored ? 'contents' : 'opacity-55'}>
                    <TitlePoster id={r.id} hasPoster={r.has_poster} size={phone ? 'md' : 'sm'} />
                  </span>
                </>
              }
              right={
                <span className="flex flex-col items-end gap-1.5">
                  <span className="flex items-center gap-2">
                    <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
                    <span title={monitored ? 'Monitored' : 'Not monitored'} data-monitor-mark={monitored ? 'on' : 'off'}>
                      <MonitorMark monitored={monitored} />
                    </span>
                  </span>
                  {!phone && <span className="label-12 text-gray-900 tabular-nums">{r.size > 0 ? size(r.size) : '—'}</span>}
                </span>
              }
            >
              <Entity.Content
                fill
                title={
                  <span className="block truncate">
                    <span data-title className={monitored ? '' : 'text-gray-900'}>
                      {r.title}
                    </span>
                    {r.year ? <span className="ml-1.5 font-normal text-gray-900">{r.year}</span> : null}
                  </span>
                }
                description={
                  <span className="flex flex-col gap-1">
                    <span data-state-line className={`block truncate ${toneText[line.tone]}`}>
                      {line.text}
                    </span>
                    <span className={dimmed}>{chips}</span>
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

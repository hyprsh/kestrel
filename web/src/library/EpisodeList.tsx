// chrome: domain-visual
import { Button, Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from '@hyprsh/design'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { usePhone } from '../responsive'
import { RowDeleteConfirm } from './DeleteFiles'
import { EpisodeMenu, EpisodeTick, RowSearch, type EpisodeActions } from './EpisodeActions'
import { EpisodeChips } from './EpisodeChips'
import { EpisodeName } from './EpisodeName'
import { airedText, weekdayDay } from './cellDetail'
import { episodeCode, episodeRow } from './episodes'
import { rowActionsShown } from './IconAction'
import { MonitorToggle } from './MonitorToggle'
import type { SlotInfo } from './slots'

/** The episodes not aired yet, folded into one row of the list under `episodes`: `expanded` has them among the rows, with this row to fold them again. */
export type UnairedFold = { episodes: Episode[]; expanded: boolean; onToggle: () => void; atStart: boolean }

/** "6 more, not aired yet (S05E11 – S05E16, from Mon, Nov 2)": what the fold row says. */
function foldText(eps: Episode[]): string {
  const numbers = eps.map((e) => e.number)
  const first = eps.find((e) => e.number === Math.min(...numbers))!
  const last = eps.find((e) => e.number === Math.max(...numbers))!
  const dates = eps.flatMap((e) => (e.air_date ? [e.air_date] : [])).sort()
  const codes = first === last ? episodeCode(first) : `${episodeCode(first)} – ${episodeCode(last)}`
  return `${eps.length} more, not aired yet (${codes}${dates.length > 0 ? `, from ${weekdayDay(dates[0])}` : ''})`
}

/** How many chips a row shows before the rest fold into "+N". */
const MAX_CHIPS = 4

/**
 * The open season's episodes: one row each with a tick box, the monitoring bookmark, its code, name and air date, then a chip
 * per Slot (STD, 4K, ...; the full state in its tooltip) under one "Slots" column. The Slots come from `slots`, any number of them.
 * Each chip is a button: its popover is that one Slot (its file, its search, its download or its monitoring). On hover a row
 * shows Search and a small ⋯ menu (Show in Log, Delete Files).
 *
 * It is one grid with a roving focus on the rows: j/k or the arrows up and down move between rows, left and right move
 * between a row's monitoring bookmark and chips (Enter or Space on the bookmark flips the episode's monitoring, on a chip opens its popover), Space on a row ticks it, Enter on a row opens its first
 * chip, x ticks (X a range), s searches, m opens Manual search, Home and End jump to the first and last row.
 * `found` is the episode the Find field matched: its row is highlighted and scrolled into view.
 */
export function EpisodeList({
  season,
  episodes,
  slots,
  actions,
  found,
  grabs,
  fold,
}: {
  season: number
  episodes: Episode[]
  slots: SlotInfo[]
  actions: EpisodeActions
  found: number | null
  /** The queue's Grabs of this Series by Slot and episode (cellDetail.ts), for the progress a downloading Slot shows. */
  grabs: Map<string, QueueItem>
  fold?: UnairedFold
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [row, setRow] = useState(0)
  const phone = usePhone()
  const { selection } = actions

  // Another season: the cursor starts at its top again and nothing is open.
  const [shownSeason, setShownSeason] = useState(season)
  if (shownSeason !== season) {
    setShownSeason(season)
    setRow(0)
  }
  const at = Math.min(row, Math.max(0, episodes.length - 1))

  const [focusNext, setFocusNext] = useState(false)
  useEffect(() => {
    if (!focusNext) return
    grid.current?.querySelector<HTMLElement>(`[data-row="${row}"]`)?.focus()
    setFocusNext(false)
  }, [focusNext, row])

  // The found episode scrolls into view (a Title page scrolls as a whole), and the cursor goes to it.
  const foundAt = found === null ? -1 : episodes.findIndex((e) => e.id === found)
  useEffect(() => {
    if (foundAt < 0) return
    setRow((p) => (p === foundAt ? p : foundAt))
    grid.current?.querySelector<HTMLElement>(`[data-episode="${found}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [found, foundAt])

  const move = (r: number) => {
    setRow(Math.min(Math.max(r, 0), episodes.length - 1))
    setFocusNext(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target instanceof Element ? e.target : null
    const rowEl = target?.closest<HTMLElement>('tr[data-row]') ?? null
    const idx = rowEl ? Number(rowEl.dataset.row) : at
    const current = episodes[idx]
    if (actions.onKey(e, current ?? null)) return
    const go = (r: number) => {
      e.preventDefault()
      e.stopPropagation() // the Library's own j/k/Enter must not also fire
      move(r)
    }
    // The row's buttons in reading order: the monitoring toggle, then a chip per Slot.
    const chips = rowEl ? Array.from(rowEl.querySelectorAll<HTMLElement>('button[data-monitor], button[data-slot]')) : []
    const onChip = target?.matches('button[data-monitor], button[data-slot]') ?? false
    const along = (step: number) => {
      const from = onChip ? chips.indexOf(target as HTMLElement) : -1
      const next = from + step
      e.preventDefault()
      e.stopPropagation()
      if (next < 0) {
        if (from >= 0) rowEl?.focus()
        return
      }
      chips[Math.min(next, chips.length - 1)]?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return go(idx + 1)
      case 'ArrowUp':
      case 'k':
        return go(idx - 1)
      case 'ArrowRight':
      case 'l':
        return along(1)
      case 'ArrowLeft':
      case 'h':
        return along(-1)
      case 'Home':
        return go(0)
      case 'End':
        return go(episodes.length - 1)
      case 'Enter':
      case ' ': {
        if (!target?.matches('tr[data-row]') || !current) return // a chip, a button or a tick box does its own
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') rowEl?.querySelector<HTMLElement>('button[data-slot]')?.click()
        else selection.toggle(current.id, { range: e.shiftKey })
      }
    }
  }

  const ticked = episodes.filter((e) => selection.has(e.id)).length
  const columns = 7

  return (
    <div ref={grid}>
      <TableRoot>
        <Table role="grid" aria-label="Episodes" aria-colcount={columns} stickyHeader onKeyDown={onKeyDown}>
          {/* A phone has one column and nothing to head: its select-all is in the season's menu, so no empty band sits above the rows. */}
          {!phone && (
            <TableHeader>
              <TableRow>
                <TableHead className="w-9 px-2">
                  <Checkbox
                    aria-label={`Select All of ${season === 0 ? 'Specials' : `Season ${season}`}`}
                    checked={episodes.length > 0 && ticked === episodes.length}
                    indeterminate={ticked > 0 && ticked < episodes.length}
                    tabIndex={-1}
                    onClick={() => (ticked === episodes.length ? selection.clear() : selection.checkAll())}
                  />
                </TableHead>
                <TableHead className="w-9 px-1">
                  <span className="sr-only">Monitored</span>
                </TableHead>
                <TableHead className="w-12 px-2 max-sm:hidden">#</TableHead>
                <TableHead truncate className="px-2">
                  Name
                </TableHead>
                <TableHead className="px-2 max-sm:hidden">Aired</TableHead>
                <TableHead align="right" className="px-2 max-sm:hidden">
                  Slots
                </TableHead>
                <TableHead align="right" className="w-17 px-2 max-sm:w-13 max-sm:px-1">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {fold?.atStart && <FoldRow fold={fold} columns={columns} rowIndex={2} />}
            {episodes.map((ep, i) => (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                slots={slots}
                index={i}
                rowIndex={i + 2 + (fold?.atStart ? 1 : 0)}
                columns={columns}
                tabbable={i === at}
                phone={phone}
                ticked={selection.has(ep.id)}
                found={ep.id === found}
                grabs={grabs}
                actions={actions}
                onFocus={() => setRow(i)}
              />
            ))}
            {fold && !fold.atStart && <FoldRow fold={fold} columns={columns} rowIndex={episodes.length + 2} />}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}

/** The row that folds the episodes not aired yet away, and brings them back. */
function FoldRow({ fold, columns, rowIndex }: { fold: UnairedFold; columns: number; rowIndex: number }) {
  const Icon = fold.expanded ? ChevronUp : ChevronDown
  return (
    <TableRow aria-rowindex={rowIndex}>
      <TableCell colSpan={columns} truncate className="px-2">
        <Button
          variant="tertiary"
          size="small"
          className="max-w-full"
          aria-expanded={fold.expanded}
          title={foldText(fold.episodes)}
          prefix={<Icon aria-hidden className="size-3.5" />}
          onClick={fold.onToggle}
        >
          <span className="min-w-0 truncate">{fold.expanded ? 'Hide the Episodes Not Aired Yet' : foldText(fold.episodes)}</span>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function EpisodeRow({
  episode,
  slots,
  index,
  rowIndex,
  columns,
  tabbable,
  phone,
  ticked,
  found,
  grabs,
  actions,
  onFocus,
}: {
  episode: Episode
  slots: SlotInfo[]
  index: number
  rowIndex: number
  columns: number
  tabbable: boolean
  phone: boolean
  ticked: boolean
  found: boolean
  grabs: Map<string, QueueItem>
  actions: EpisodeActions
  onFocus: () => void
}) {
  const code = episodeCode(episode)
  const off = !episode.monitored
  const [menuOpen, setMenuOpen] = useState(false)
  const toggle = (
    <MonitorToggle
      name={code}
      monitored={episode.monitored}
      tabIndex={-1}
      iconSize={phone ? 20 : 16}
      size={phone ? 'small' : 'tiny'}
      onToggle={() => actions.monitor([episode], !episode.monitored)}
      onFocus={onFocus}
    />
  )
  const shared = {
    'aria-rowindex': rowIndex,
    'data-row': index,
    'data-episode': episode.id,
    'data-monitored': off ? 'off' : 'on',
    'data-menu-open': menuOpen ? '' : undefined,
    tabIndex: tabbable ? 0 : -1,
    selected: ticked,
    current: found,
    onFocus: (e: React.FocusEvent) => e.target === e.currentTarget && onFocus(),
    className: `group/row ${off ? 'bg-background-200' : ''}`,
  }
  return (
    <>
      {phone ? (
        <TableRow {...shared} aria-label={`${code} ${episode.primary_name || episode.name}`}>
          <TableCell colSpan={columns} wrap className="px-2 py-1">
            <div className="flex items-center gap-1.5">
              <EpisodeTick actions={actions} episode={episode} tabIndex={-1} onFocus={onFocus} />
              <span className="label-12-mono shrink-0 text-gray-900">E{String(episode.number).padStart(2, '0')}</span>
              {/* The chips sit on the name's line when they fit, and wrap under it when they do not. */}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={`label-14 max-w-full min-w-0 truncate ${off ? 'text-gray-700' : ''}`}>
                  <EpisodeName episode={episode} />
                </span>
                <EpisodeChips episode={episode} slots={slots} grabs={grabs} actions={actions} max={slots.length} wrap align="start" />
              </div>
              {toggle}
              <EpisodeMenu actions={actions} episode={episode} onOpenChange={setMenuOpen} />
            </div>
          </TableCell>
        </TableRow>
      ) : (
        <TableRow {...shared}>
          <TableCell className="px-2">
            <EpisodeTick actions={actions} episode={episode} tabIndex={-1} onFocus={onFocus} />
          </TableCell>
          <TableCell className="px-1">{toggle}</TableCell>
          <TableCell className="px-2">
            <span className="label-12-mono text-gray-900">E{String(episode.number).padStart(2, '0')}</span>
          </TableCell>
          <TableCell truncate className={`px-2 ${off ? 'text-gray-700' : ''}`}>
            <EpisodeName episode={episode} />
          </TableCell>
          <TableCell className="px-2 text-gray-900">{episode.air_date ? airedText(episode.air_date) : '—'}</TableCell>
          <TableCell align="right" className="px-2">
            <EpisodeChips episode={episode} slots={slots} grabs={grabs} actions={actions} max={MAX_CHIPS} tabIndex={-1} />
          </TableCell>
          <TableCell align="right" className="px-2">
            <span className={`flex items-center justify-end gap-1 ${rowActionsShown}`}>
              <RowSearch actions={actions} episode={episode} />
              <EpisodeMenu actions={actions} episode={episode} onOpenChange={setMenuOpen} />
            </span>
          </TableCell>
        </TableRow>
      )}
      <RowDeleteConfirm deletes={actions.deletes} at={episodeRow(episode.id)} columns={columns} />
    </>
  )
}

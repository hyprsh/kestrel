import { Button, Checkbox, StatusDot, Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from '@hyprsh/design'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Episode } from '../api/queries'
import { usePhone } from '../responsive'
import { dotOf, faintDot, slotLabel, versionStatus, type SlotKey } from './bits'
import { RowDeleteConfirm } from './DeleteFiles'
import { EpisodeMenu, EpisodeTick, RowButtons, type EpisodeActions } from './EpisodeActions'
import { CellPopover, EpisodeFilePopover, cellTitle } from './EpisodeFilePopover'
import { EpisodeName } from './EpisodeName'
import { episodeRow } from './episodes'

/**
 * The open season's episodes × Slots: a row per episode with a tick box, its code, name and air date, a state per Slot that
 * has a Version, and visible Search (Upgrade on an episode with a file) and Manual… buttons. It is one grid with a roving
 * focus: arrows (or h/j/k/l) move between the tick box and the Slot cells, Space on a Slot cell toggles the episode's
 * monitoring, Space on the tick box ticks it, x ticks (X a range), s searches, m opens Manual search, Shift+F10 or the menu
 * key opens the row's menu, and Home and End jump to the first and last row. `found` is the episode the Find field
 * matched: its row is highlighted and scrolled into view.
 */
export function EpisodeMatrix({ season, episodes, slots, actions, found }: { season: number; episodes: Episode[]; slots: SlotKey[]; actions: EpisodeActions; found: number | null }) {
  const grid = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ row: 0, col: 0 })
  // The row whose "…" menu is open: a menu can open upwards over other rows, so its own row is marked.
  const [menuRow, setMenuRow] = useState<string | null>(null)
  const menuOf = (key: string) => (open: boolean) => setMenuRow((cur) => (open ? key : cur === key ? null : cur))
  const columns = 1 + slots.length
  const { selection } = actions

  // Another season: the cursor starts at its top again.
  const [shownSeason, setShownSeason] = useState(season)
  if (shownSeason !== season) {
    setShownSeason(season)
    setPos({ row: 0, col: 0 })
  }
  const row = Math.min(pos.row, Math.max(0, episodes.length - 1))

  // Moving focus is a position change followed by focusing the cell at it.
  const [focusNext, setFocusNext] = useState(false)
  useEffect(() => {
    if (!focusNext) return
    grid.current?.querySelector<HTMLElement>(`[data-cell="${pos.row}-${pos.col}"]`)?.focus()
    setFocusNext(false)
  }, [focusNext, pos])

  // The found episode scrolls into view (a Title page scrolls as a whole), and the cursor goes to it.
  const foundAt = found === null ? -1 : episodes.findIndex((e) => e.id === found)
  useEffect(() => {
    if (foundAt < 0) return
    setPos((p) => (p.row === foundAt ? p : { row: foundAt, col: 0 }))
    grid.current?.querySelector<HTMLElement>(`[data-episode="${found}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [found, foundAt])

  const move = (r: number, col: number) => {
    const next = Math.min(Math.max(r, 0), episodes.length - 1)
    setPos({ row: next, col: Math.min(Math.max(col, 0), columns - 1) })
    setFocusNext(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const col = pos.col
    const at = episodes[row]
    if (actions.onKey(e, at ?? null, col > 0 ? (slots[col - 1] ?? null) : null)) return
    const go = (r: number, c: number) => {
      e.preventDefault()
      e.stopPropagation() // the Library's own j/k/Enter must not also fire
      move(r, c)
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return go(row + 1, col)
      case 'ArrowUp':
      case 'k':
        return go(row - 1, col)
      case 'ArrowRight':
      case 'l':
        return go(row, col + 1)
      case 'ArrowLeft':
      case 'h':
        return go(row, col - 1)
      case 'Home':
        return go(0, col)
      case 'End':
        return go(episodes.length - 1, col)
      case 'Enter':
      case ' ': {
        // On a button the click does it, and on a checkbox Space does; Space on a Slot cell (whose Enter opens its popover) toggles the row's monitoring.
        const onCell = e.key === ' ' && e.target instanceof Element && e.target.matches('button[data-cell]')
        if (e.target instanceof Element && e.target.closest('button') && !onCell) return
        if (e.target instanceof HTMLInputElement || !at) return
        e.preventDefault()
        e.stopPropagation()
        actions.monitor([at], !at.monitored)
        return
      }
    }
  }

  const tab = (r: number, c: number) => (row === r && pos.col === c ? 0 : -1)
  const ticked = episodes.filter((e) => selection.has(e.id)).length

  return (
    <div ref={grid}>
      <TableRoot>
        <Table
          role="grid"
          aria-label="Episodes"
          aria-colcount={columns + 4}
          onKeyDown={onKeyDown}
          // Space on a Slot cell button would click it on key-up: the grid has already used the key.
          onKeyUp={(e) => e.key === ' ' && e.target instanceof Element && e.target.matches('button[data-cell]') && e.preventDefault()}
        >
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label={`Tick all of ${season === 0 ? 'Specials' : `Season ${season}`}`}
                  checked={episodes.length > 0 && ticked === episodes.length}
                  indeterminate={ticked > 0 && ticked < episodes.length}
                  tabIndex={-1}
                  onClick={() => (ticked === episodes.length ? selection.clear() : selection.checkAll())}
                />
              </TableHead>
              <TableHead className="max-sm:hidden">#</TableHead>
              <TableHead className="max-sm:px-1">Name</TableHead>
              <TableHead className="max-sm:hidden">Aired</TableHead>
              {slots.map((s) => (
                <TableHead key={s} className="max-sm:px-1">
                  {slotLabel[s]}
                </TableHead>
              ))}
              <TableHead align="right" className="max-sm:px-1 max-sm:sr-only">
                Search
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {episodes.map((ep, i) => (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                slots={slots}
                index={i}
                columns={columns + 4}
                tab={tab}
                ticked={selection.has(ep.id)}
                found={ep.id === found}
                onFocus={(col) => setPos({ row: i, col })}
                menuOpen={menuRow === episodeRow(ep.id)}
                actions={actions}
                onMenuOpenChange={menuOf(episodeRow(ep.id))}
              />
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}

function EpisodeRow({
  episode,
  slots,
  index,
  columns,
  tab,
  ticked,
  found,
  onFocus,
  menuOpen,
  actions,
  onMenuOpenChange,
}: {
  episode: Episode
  slots: SlotKey[]
  index: number
  columns: number
  tab: (row: number, col: number) => number
  ticked: boolean
  found: boolean
  onFocus: (col: number) => void
  menuOpen: boolean
  actions: EpisodeActions
  onMenuOpenChange: (open: boolean) => void
}) {
  const label = `Season ${episode.season} episode ${episode.number}`
  const phone = usePhone()
  return (
    <>
      <TableRow aria-rowindex={index + 2} data-episode={episode.id} data-menu-open={menuOpen ? '' : undefined} selected={ticked} current={found}>
        <TableCell className="max-sm:px-1">
          <EpisodeTick actions={actions} episode={episode} cell={`${index}-0`} tabIndex={tab(index, 0)} onFocus={() => onFocus(0)} />
        </TableCell>
        <TableCell className="text-gray-900 max-sm:hidden">
          {episode.season}x{String(episode.number).padStart(2, '0')}
        </TableCell>
        <TableCell truncate className="max-sm:px-1">
          <span className="label-12 mr-1 text-gray-900 sm:hidden">
            {episode.season}x{String(episode.number).padStart(2, '0')}
          </span>
          <EpisodeName episode={episode} />
        </TableCell>
        <TableCell className="text-gray-900 max-sm:hidden">{episode.air_date ?? '—'}</TableCell>
        {slots.map((s, c) => {
          const cell = episode.cells[s]
          const state = cell ? versionStatus(cell.state).label : 'no Version'
          const dot = dotOf(cell ? cell.state : null, false)
          const button = (
            <Button
              variant="tertiary"
              size="tiny"
              aria-label={`${label} ${slotLabel[s]}: ${state}`}
              title={cellTitle(slotLabel[s], state, cell)}
              data-cell={`${index}-${c + 1}`}
              tabIndex={tab(index, c + 1)}
              onFocus={() => onFocus(c + 1)}
              prefix={<StatusDot state={dot.state} variant={dot.variant} label={false} title={null} aria-hidden className={dot.faint ? faintDot : undefined} />}
            >
              <span className="max-sm:sr-only">{cell ? state : '—'}</span>
            </Button>
          )
          return (
            <TableCell key={s} className="max-sm:px-1">
              {cell?.file ? (
                <EpisodeFilePopover label={`${label} ${slotLabel[s]}`} cell={cell} file={cell.file} trigger={button} />
              ) : phone ? (
                // No hover on a phone: a tap says what the state means.
                <CellPopover label={`${label} ${slotLabel[s]}`} text={cellTitle(slotLabel[s], state, cell)} trigger={button} />
              ) : (
                button
              )}
            </TableCell>
          )
        })}
        <TableCell align="right" className="max-sm:px-1">
          <span className="flex items-center justify-end gap-1">
            <RowButtons actions={actions} episode={episode} />
            <EpisodeMenu actions={actions} episode={episode} onOpenChange={onMenuOpenChange} />
          </span>
        </TableCell>
      </TableRow>
      <RowDeleteConfirm deletes={actions.deletes} at={episodeRow(episode.id)} columns={columns} />
    </>
  )
}

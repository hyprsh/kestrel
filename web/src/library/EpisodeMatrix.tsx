// chrome: pending
import { Checkbox, Note, Spinner } from '@hyprsh/design'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ApiError, useEpisodes, useMonitorEpisodes, usePatchSeason, type Episode } from '../api/queries'
import { cx } from '../ui'
import { slotLabel, versionStatus, type SlotKey } from './bits'
import { EpisodeMenu, EpisodeTick, SeasonMenu, type EpisodeActions } from './EpisodeActions'
import { SeasonSummary, SeasonToggle } from './SeasonSummary'
import type { SeasonOpen } from './useSeasonOpen'
import { RowDeleteConfirm } from './DeleteFiles'
import { CellPopover, EpisodeFilePopover, cellTitle } from './EpisodeFilePopover'
import { usePhone } from '../responsive'
import { EpisodeName } from './EpisodeName'
import { episodeRow, seasonName, seasonRow } from './episodes'

type Row = { kind: 'season'; season: number; episodes: Episode[] } | { kind: 'episode'; episode: Episode }

// On a phone the grid keeps its layout and scrolls sideways only when a row does not fit: a row has a
// minimum width, and its episode column stays pinned at the left edge over the Slot columns.
const rowMin = 'max-sm:min-w-[20rem]'
const pin = 'max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:bg-background-100'

function cellClass(state: string): string {
  switch (state) {
    case 'filled':
      return 'bg-green-700'
    case 'downloading':
      return 'bg-blue-700'
    case 'wanted':
      return 'border-2 border-amber-700'
    case 'unreleased':
      return 'border border-dashed border-gray-700'
    default:
      return 'bg-gray-400'
  }
}

/** Where a row is now: its own index if it is still shown, or else its season's header. */
function followRow(rows: Row[], was: Row): { row: number; same: boolean } {
  const season = was.kind === 'season' ? was.season : was.episode.season
  const same = rows.findIndex((r) => (r.kind === 'season' ? was.kind === 'season' && r.season === season : was.kind === 'episode' && r.episode.id === was.episode.id))
  if (same >= 0) return { row: same, same: true }
  return { row: Math.max(0, rows.findIndex((r) => r.kind === 'season' && r.season === season)), same: false }
}

/**
 * The episodes × Slots heat map of a Series: a season row to toggle a whole
 * season and a row per episode with its monitoring toggle and one cell per
 * Slot that has a Version. It is one grid with a roving focus: arrows (or
 * h/j/k/l) move between cells, Space (or Enter on an episode) toggles
 * monitoring, Home and End jump to the first and last row. Enter, Right and
 * Left on a season header open and close it; a closed season shows only its
 * header row, with a summary, and the arrows skip its episodes. With `actions`,
 * each row has a menu (Shift+F10 or the menu key opens it) and x ticks an
 * episode for the actions on several.
 */
export function EpisodeMatrix({ titleId, slots, seasons, actions }: { titleId: number; slots: SlotKey[]; seasons: SeasonOpen; actions?: EpisodeActions }) {
  const episodes = useEpisodes(titleId)
  const patchSeason = usePatchSeason(titleId)
  const monitor = useMonitorEpisodes(titleId)
  const grid = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ row: 0, col: 0 })
  // The row whose "…" menu is open: a menu can open upwards over other rows, so its own row is marked.
  const [menuRow, setMenuRow] = useState<string | null>(null)
  const menuOf = (key: string) => (open: boolean) => setMenuRow((cur) => (open ? key : cur === key ? null : cur))
  const columns = 1 + slots.length

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const bySeason = new Map<number, Episode[]>()
    for (const e of episodes.data ?? []) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e])
    for (const [season, eps] of bySeason) {
      out.push({ kind: 'season', season, episodes: eps })
      if (seasons.isOpen(season)) for (const e of eps) out.push({ kind: 'episode', episode: e }) // a closed season shows only its header
    }
    return out
  }, [episodes.data, seasons])

  // Rows come and go as seasons open and close: keep the tab stop on the same row, or on its season's header.
  const shown = useRef(rows)
  useEffect(() => {
    const was = shown.current[pos.row]
    shown.current = rows
    if (!was || rows[pos.row] === was) return
    const at = followRow(rows, was)
    if (at.row !== pos.row) setPos({ row: at.row, col: at.same ? pos.col : 0 })
  }, [rows, pos])

  // Moving focus is a position change followed by focusing the cell at it.
  const [focusNext, setFocusNext] = useState(false)
  useEffect(() => {
    if (!focusNext) return
    grid.current?.querySelector<HTMLElement>(`[data-cell="${pos.row}-${pos.col}"]`)?.focus()
    setFocusNext(false)
  }, [focusNext, pos])

  if (episodes.isError) {
    return (
      <Note variant="error" size="small">
        {episodes.error instanceof ApiError ? episodes.error.message : 'Could not load the episodes.'}
      </Note>
    )
  }
  if (!episodes.data)
    return (
      <p className="copy-13 flex items-center gap-2 text-gray-900">
        <Spinner size="sm" /> Loading episodes…
      </p>
    )
  if (rows.length === 0) return <p className="copy-13 text-gray-900">TheTVDB lists no episodes yet.</p>

  const move = (row: number, col: number) => {
    const r = Math.min(Math.max(row, 0), rows.length - 1)
    const maxCol = rows[r].kind === 'season' ? 0 : columns - 1
    setPos({ row: r, col: Math.min(Math.max(col, 0), maxCol) })
    setFocusNext(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const { row, col } = pos
    const at = rows[row]
    if (actions?.onKey(e, at?.kind === 'episode' ? at.episode : null)) return
    const go = (r: number, c: number) => {
      e.preventDefault()
      e.stopPropagation() // the Library's own j/k/Enter must not also fire
      move(r, c)
    }
    // On a season header Enter flips it open or closed, Right (l) opens and Left (h) closes; Space toggles its monitoring.
    if (at?.kind === 'season' && ['Enter', 'ArrowRight', 'l', 'ArrowLeft', 'h'].includes(e.key)) {
      e.preventDefault() // also stops Enter clicking the focused checkbox
      e.stopPropagation()
      seasons.set(at.season, e.key === 'Enter' ? !seasons.isOpen(at.season) : e.key === 'ArrowRight' || e.key === 'l')
      return
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
        return go(rows.length - 1, col)
      case 'Enter':
      case ' ': {
        // On a button the click does it, and on a checkbox Space does; on a Slot cell, or Enter on a checkbox, the row's monitoring is toggled.
        if (e.target instanceof Element && e.target.closest('button')) return
        if (e.key === ' ' && e.target instanceof HTMLInputElement) return
        e.preventDefault()
        e.stopPropagation()
        if (at.kind === 'season') patchSeason.mutate({ season: at.season, monitored: !at.episodes.some((x) => x.monitored) })
        else monitor.mutate({ ids: [at.episode.id], monitored: !at.episode.monitored })
        return
      }
    }
  }

  const tab = (row: number, col: number) => (pos.row === row && pos.col === col ? 0 : -1)

  return (
    <div
      ref={grid}
      role="grid"
      aria-label="Episodes"
      aria-colcount={columns}
      onKeyDown={onKeyDown}
      className="copy-13 rounded-lg max-sm:overflow-x-auto border border-gray-alpha-400"
    >
      <div role="row" className={cx('label-12-mono flex items-center gap-3 border-b border-gray-alpha-400 px-3 py-1.5 text-gray-900', rowMin)}>
        <span role="columnheader" className={cx('flex-1', pin)}>
          Episode
        </span>
        {slots.map((s) => (
          <span key={s} role="columnheader" className="w-10 text-center">
            {slotLabel[s]}
          </span>
        ))}
      </div>
      {rows.map((r, i) =>
        r.kind === 'season' ? (
          <SeasonRow
            key={`s${r.season}`}
            row={r}
            index={i}
            tabIndex={tab(i, 0)}
            onFocus={() => setPos({ row: i, col: 0 })}
            onToggle={(monitored) => patchSeason.mutate({ season: r.season, monitored })}
            open={seasons.isOpen(r.season)}
            onOpen={(open) => seasons.set(r.season, open)}
            slots={slots}
            menuOpen={menuRow === seasonRow(r.season)}
            menu={actions && <SeasonMenu actions={actions} season={r.season} episodes={r.episodes} onOpenChange={menuOf(seasonRow(r.season))} />}
            after={actions && <RowDeleteConfirm deletes={actions.deletes} at={seasonRow(r.season)} columns={columns} />}
          />
        ) : (
          <EpisodeRow
            key={r.episode.id}
            episode={r.episode}
            slots={slots}
            index={i}
            tab={tab}
            onFocus={(col) => setPos({ row: i, col })}
            onToggle={() => monitor.mutate({ ids: [r.episode.id], monitored: !r.episode.monitored })}
            tick={actions && <EpisodeTick actions={actions} episode={r.episode} />}
            menuOpen={menuRow === episodeRow(r.episode.id)}
            menu={actions && <EpisodeMenu actions={actions} episode={r.episode} onOpenChange={menuOf(episodeRow(r.episode.id))} />}
            after={actions && <RowDeleteConfirm deletes={actions.deletes} at={episodeRow(r.episode.id)} columns={columns} />}
          />
        ),
      )}
    </div>
  )
}

function SeasonRow({
  row,
  index,
  tabIndex,
  onFocus,
  onToggle,
  open,
  onOpen,
  slots,
  menuOpen,
  menu,
  after,
}: {
  row: Extract<Row, { kind: 'season' }>
  index: number
  tabIndex: number
  onFocus: () => void
  onToggle: (monitored: boolean) => void
  open: boolean
  onOpen: (open: boolean) => void
  slots: SlotKey[]
  /** Whether the row's own "…" menu is open. */
  menuOpen?: boolean
  menu?: ReactNode
  /** What shows right under the row, such as a question asked from its menu. */
  after?: ReactNode
}) {
  const on = row.episodes.filter((e) => e.monitored).length
  return (
    <>
      <div role="row" aria-rowindex={index + 2} data-menu-open={menuOpen ? '' : undefined} className="flex items-center gap-3 border-t border-gray-alpha-400 bg-gray-alpha-100 px-3 py-1.5 data-[menu-open]:bg-gray-alpha-200 max-sm:sticky max-sm:left-0 max-sm:min-h-11">
        <div role="gridcell" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Checkbox
            aria-label={seasonName(row.season)}
            checked={on === row.episodes.length}
            indeterminate={on > 0 && on < row.episodes.length}
            data-cell={`${index}-0`}
            tabIndex={tabIndex}
            onFocus={onFocus}
            onClick={() => onToggle(on === 0)}
          />
          <SeasonToggle name={seasonName(row.season)} open={open} onToggle={() => onOpen(!open)} onFocus={onFocus} />
          <span className="label-12 text-gray-900">
            {on} of {row.episodes.length} monitored
          </span>
          {!open && <SeasonSummary episodes={row.episodes} slots={slots} />}
          {menu && <span className="ml-auto">{menu}</span>}
        </div>
      </div>
      {after}
    </>
  )
}

function EpisodeRow({
  episode,
  slots,
  index,
  tab,
  onFocus,
  onToggle,
  tick,
  menuOpen,
  menu,
  after,
}: {
  episode: Episode
  slots: SlotKey[]
  index: number
  tab: (row: number, col: number) => number
  onFocus: (col: number) => void
  onToggle: () => void
  tick?: ReactNode
  /** Whether the row's own "…" menu is open. */
  menuOpen?: boolean
  menu?: ReactNode
  /** What shows right under the row, such as a question asked from its menu. */
  after?: ReactNode
}) {
  const label = `Season ${episode.season} episode ${episode.number}`
  const phone = usePhone()
  return (
    <>
      <div role="row" aria-rowindex={index + 2} data-menu-open={menuOpen ? '' : undefined} className={cx('flex items-center gap-3 px-3 py-1 hover:bg-gray-alpha-100 data-[menu-open]:bg-gray-alpha-200 max-sm:min-h-11', rowMin)}>
        <div role="gridcell" className={cx('flex min-w-0 flex-1 items-center gap-2', pin)}>
          {tick}
          <Checkbox
            aria-label={`${label} monitored`}
            checked={episode.monitored}
            data-cell={`${index}-0`}
            tabIndex={tab(index, 0)}
            onFocus={() => onFocus(0)}
            onClick={onToggle}
          />
          <span className="label-12-mono w-14 shrink-0 text-gray-900 max-sm:w-11">
            {episode.season}x{String(episode.number).padStart(2, '0')}
          </span>
          <span className="flex min-w-0 max-sm:flex-1">
            <EpisodeName episode={episode} />
          </span>
          <span className="label-12 ml-auto shrink-0 text-gray-900 max-sm:hidden">{episode.air_date ?? 'no air date'}</span>
          {menu}
        </div>
        {slots.map((s, c) => {
          const cell = episode.cells[s]
          const state = cell ? versionStatus(cell.state).label : 'no Version'
          const square = (
            <span
              role="img"
              aria-label={`${label} ${slotLabel[s]}: ${state}`}
              title={cellTitle(slotLabel[s], state, cell)}
              data-cell={`${index}-${c + 1}`}
              tabIndex={tab(index, c + 1)}
              onFocus={() => onFocus(c + 1)}
              className={cx(
                // A 44px hit area around the square on a phone.
                'relative size-4 rounded-sm outline-none after:absolute after:-inset-3 after:content-[""] focus-visible:ring-2 focus-visible:ring-blue-700 max-sm:size-5',
                cell ? cellClass(cell.state) : 'border border-gray-alpha-400',
              )}
            />
          )
          return (
            <div key={s} role="gridcell" className="flex w-10 justify-center">
              {cell?.file ? (
                <EpisodeFilePopover label={`${label} ${slotLabel[s]}`} cell={cell} file={cell.file} trigger={square} />
              ) : phone ? (
                // No hover on a phone: a tap says what the colour means.
                <CellPopover label={`${label} ${slotLabel[s]}`} text={cellTitle(slotLabel[s], state, cell)} trigger={square} />
              ) : (
                square
              )}
            </div>
          )
        })}
      </div>
      {after}
    </>
  )
}

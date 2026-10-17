import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError, useEpisodes, useMonitorEpisodes, usePatchSeason, type Episode } from '../api/queries'
import { cx } from '../ui'
import { slotLabel, versionStatus, type SlotKey } from './bits'

type Row = { kind: 'season'; season: number; episodes: Episode[] } | { kind: 'episode'; episode: Episode }

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

const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/**
 * The episodes × Slots heat map of a Series: a season row to toggle a whole
 * season and a row per episode with its monitoring toggle and one cell per
 * Slot that has a Version. It is one grid with a roving focus: arrows (or
 * h/j/k/l) move between cells, Space or Enter toggles monitoring, Home and End
 * jump to the first and last row.
 */
export function EpisodeMatrix({ titleId, slots }: { titleId: number; slots: SlotKey[] }) {
  const episodes = useEpisodes(titleId)
  const patchSeason = usePatchSeason(titleId)
  const monitor = useMonitorEpisodes(titleId)
  const grid = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ row: 0, col: 0 })
  const columns = 1 + slots.length

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const bySeason = new Map<number, Episode[]>()
    for (const e of episodes.data ?? []) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e])
    for (const [season, eps] of bySeason) {
      out.push({ kind: 'season', season, episodes: eps })
      for (const e of eps) out.push({ kind: 'episode', episode: e })
    }
    return out
  }, [episodes.data])

  // Moving focus is a position change followed by focusing the cell at it.
  const [focusNext, setFocusNext] = useState(false)
  useEffect(() => {
    if (!focusNext) return
    grid.current?.querySelector<HTMLElement>(`[data-cell="${pos.row}-${pos.col}"]`)?.focus()
    setFocusNext(false)
  }, [focusNext, pos])

  if (episodes.isError) {
    return (
      <p role="alert" className="text-[12px] text-red-900">
        {episodes.error instanceof ApiError ? episodes.error.message : 'Could not load the episodes.'}
      </p>
    )
  }
  if (!episodes.data) return <p className="text-gray-900">Loading episodes…</p>
  if (rows.length === 0) return <p className="text-gray-900">TheTVDB lists no episodes yet.</p>

  const move = (row: number, col: number) => {
    const r = Math.min(Math.max(row, 0), rows.length - 1)
    const maxCol = rows[r].kind === 'season' ? 0 : columns - 1
    setPos({ row: r, col: Math.min(Math.max(col, 0), maxCol) })
    setFocusNext(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const { row, col } = pos
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
        return go(rows.length - 1, col)
      case 'Enter':
      case ' ': {
        // On a toggle button the click does it; on a Slot cell the row's monitoring is toggled.
        if (e.target instanceof Element && e.target.closest('button')) return
        e.preventDefault()
        e.stopPropagation()
        const r = rows[row]
        if (r.kind === 'season') patchSeason.mutate({ season: r.season, monitored: !r.episodes.some((x) => x.monitored) })
        else monitor.mutate({ ids: [r.episode.id], monitored: !r.episode.monitored })
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
      className="rounded-lg border border-gray-alpha-400 text-[13px]"
    >
      <div role="row" className="flex items-center gap-3 border-b border-gray-alpha-400 px-3 py-1.5 font-mono text-[11px] text-gray-900">
        <span role="columnheader" className="flex-1">
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
}: {
  row: Extract<Row, { kind: 'season' }>
  index: number
  tabIndex: number
  onFocus: () => void
  onToggle: (monitored: boolean) => void
}) {
  const on = row.episodes.filter((e) => e.monitored).length
  const checked = on === 0 ? 'false' : on === row.episodes.length ? 'true' : 'mixed'
  return (
    <div role="row" aria-rowindex={index + 2} className="flex items-center gap-3 border-t border-gray-alpha-400 bg-gray-alpha-100 px-3 py-1.5">
      <div role="gridcell" className="flex flex-1 items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={seasonName(row.season)}
          data-cell={`${index}-0`}
          tabIndex={tabIndex}
          onFocus={onFocus}
          onClick={() => onToggle(on === 0)}
          className={cx('size-4 shrink-0 rounded border border-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-700', checked !== 'false' && 'bg-gray-1000')}
        />
        <span className="font-medium">{seasonName(row.season)}</span>
        <span className="text-[12px] text-gray-900">
          {on} of {row.episodes.length} monitored
        </span>
      </div>
    </div>
  )
}

function EpisodeRow({
  episode,
  slots,
  index,
  tab,
  onFocus,
  onToggle,
}: {
  episode: Episode
  slots: SlotKey[]
  index: number
  tab: (row: number, col: number) => number
  onFocus: (col: number) => void
  onToggle: () => void
}) {
  const label = `Season ${episode.season} episode ${episode.number}`
  return (
    <div role="row" aria-rowindex={index + 2} className="flex items-center gap-3 px-3 py-1 hover:bg-gray-alpha-100">
      <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={episode.monitored}
          aria-label={`${label} monitored`}
          data-cell={`${index}-0`}
          tabIndex={tab(index, 0)}
          onFocus={() => onFocus(0)}
          onClick={onToggle}
          className={cx('size-4 shrink-0 rounded border border-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-700', episode.monitored && 'bg-gray-1000')}
        />
        <span className="w-14 shrink-0 font-mono text-[11px] text-gray-900">
          {episode.season}x{String(episode.number).padStart(2, '0')}
        </span>
        <span className="truncate">{episode.name || 'TBA'}</span>
        <span className="ml-auto shrink-0 text-[12px] text-gray-900">{episode.air_date ?? 'no air date'}</span>
      </div>
      {slots.map((s, c) => {
        const cell = episode.cells[s]
        const state = cell ? versionStatus(cell.state).label : 'no Version'
        return (
          <div key={s} role="gridcell" className="flex w-10 justify-center">
            <span
              role="img"
              aria-label={`${label} ${slotLabel[s]}: ${state}`}
              title={`${slotLabel[s]}: ${state}${cell?.score != null ? ` · Score ${cell.score}` : ''}`}
              data-cell={`${index}-${c + 1}`}
              tabIndex={tab(index, c + 1)}
              onFocus={() => onFocus(c + 1)}
              className={cx('size-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-700', cell ? cellClass(cell.state) : 'border border-gray-alpha-400')}
            />
          </div>
        )
      })}
    </div>
  )
}

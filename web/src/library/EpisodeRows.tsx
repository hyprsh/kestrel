// chrome: domain-visual
import { Button } from '@hyprsh/design'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { usePhone } from '../responsive'
import { CellButton } from './CellButton'
import { RowDeleteConfirm } from './DeleteFiles'
import { EpisodeMenu, EpisodeTick, type EpisodeActions } from './EpisodeActions'
import { EpisodeFilePopover } from './EpisodeFilePopover'
import { EpisodeName } from './EpisodeName'
import { airedText, grabOf, weekdayDay } from './cellDetail'
import { episodeCellView, useCellItems } from './cellItems'
import { episodeCode, episodeRow } from './episodes'
import { cellOf, type SlotInfo } from './slots'
import { gridOf, TRACKS } from './tableGrid'

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

/**
 * The open season's episodes, rows of the season table: each with a tick box, its code, name and air date, then one cell per Version
 * (a quiet check for a file, else the state with a menu of that Version's actions for the episode) and the episode's ⋯ menu. The Versions
 * come from `slots`, any number of them (at most four).
 *
 * The rows have a roving focus: j/k or the arrows up and down move between rows, left and right between a row's cells (Enter or Space on a
 * cell opens its menu), Space on a row ticks it, Enter on a row opens its first cell, x ticks (X a range), s searches, m opens Manual search,
 * Home and End jump to the first and last row.
 * `found` is the episode the Find field matched: its row is highlighted and scrolled into view.
 */
export function EpisodeRows({
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
  /** The queue's Grabs of this Series by Slot and episode (cellDetail.ts), for the progress a downloading Version shows. */
  grabs: Map<string, QueueItem>
  fold?: UnairedFold
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [row, setRow] = useState(0)
  const phone = usePhone()
  const { selection } = actions

  // Another season: the cursor starts at its top again.
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
    const rowEl = target?.closest<HTMLElement>('[data-row]') ?? null
    const idx = rowEl ? Number(rowEl.dataset.row) : at
    const current = episodes[idx]
    if (actions.onKey(e, current ?? null)) return
    const go = (r: number) => {
      e.preventDefault()
      e.stopPropagation() // the Library's own j/k/Enter must not also fire
      move(r)
    }
    // The row's cell buttons in reading order.
    const cells = rowEl ? Array.from(rowEl.querySelectorAll<HTMLElement>('button[data-cell]')) : []
    const onCell = target?.matches('button[data-cell]') ?? false
    const along = (step: number) => {
      const from = onCell ? cells.indexOf(target as HTMLElement) : -1
      const next = from + step
      e.preventDefault()
      e.stopPropagation()
      if (next < 0) {
        if (from >= 0) rowEl?.focus()
        return
      }
      cells[Math.min(next, cells.length - 1)]?.focus()
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
        if (!target?.hasAttribute('data-row') || !current) return // a cell, a button or a tick box does its own
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') rowEl?.querySelector<HTMLElement>('button[data-cell]')?.click()
        else selection.toggle(current.id, { range: e.shiftKey })
      }
    }
  }

  return (
    <div ref={grid} role="rowgroup" aria-label={`${season === 0 ? 'Specials' : `Season ${season}`} episodes`} onKeyDown={onKeyDown}>
      {fold?.atStart && <FoldRow fold={fold} />}
      {episodes.map((ep, i) => (
        <EpisodeRow
          key={ep.id}
          episode={ep}
          slots={slots}
          index={i}
          tabbable={i === at}
          phone={phone}
          ticked={selection.has(ep.id)}
          found={ep.id === found}
          grabs={grabs}
          actions={actions}
          onFocus={() => setRow(i)}
        />
      ))}
      {fold && !fold.atStart && <FoldRow fold={fold} />}
    </div>
  )
}

/** The row that folds the episodes not aired yet away, and brings them back. */
function FoldRow({ fold }: { fold: UnairedFold }) {
  const Icon = fold.expanded ? ChevronUp : ChevronDown
  return (
    <div role="row" className="flex border-t border-gray-alpha-100 bg-gray-alpha-100 px-3 py-1">
      <span role="cell" className="flex min-w-0 max-w-full">
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
      </span>
    </div>
  )
}

function EpisodeRow({
  episode,
  slots,
  index,
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
  // Only the text of a row that is not monitored is dimmed, never its cells or ⋯; an episode not out yet is not dimmed at all.
  const dim = off && !slots.some((s) => cellOf(episode, s.key)?.state === 'unreleased')
  const [menuOpen, setMenuOpen] = useState(false)
  const items = useCellItems(actions)
  const grid = gridOf(slots.length, phone)
  const primary = episode.primary_name || episode.name
  const cells = slots.map((s) => {
    const grab = grabOf(grabs, s.key, episode)
    const view = episodeCellView(episode, s.key, grab)
    const version = actions.versions.find((v) => v.slot === s.key)
    const cell = cellOf(episode, s.key)
    const label = `${code} ${s.name}`
    let body = null
    if (view && cell && version) {
      if (cell.file) {
        const file = cell.file
        body = (
          <EpisodeFilePopover
            label={label}
            heading={`${code} · ${s.name}`}
            cell={cell}
            file={file}
            onUpgrade={() => actions.upgrade(version, episode)}
            onManual={() => actions.manual(version, { season: episode.season, episode_ids: [episode.id] }, code)}
            trigger={
              <Button variant="tertiary" size="small" svgOnly aria-label={`${label}: Have`} title={`${s.name}: Have`} data-cell="" tabIndex={-1} onFocus={onFocus}>
                <Check aria-hidden className="size-3.5 text-gray-600" />
              </Button>
            }
          />
        )
      } else {
        body = (
          <CellButton
            kind={view.kind}
            text={view.text}
            count={view.count}
            label={`${label}: ${view.say}`}
            title={`${code} · ${s.name}`}
            status={view.say}
            items={items.episode(version, episode, view)}
            phone={phone}
            small
            tabIndex={-1}
            onFocus={onFocus}
          />
        )
      }
    }
    return (
      <span key={s.key} role="cell" className={`flex min-w-0 items-center border-l border-gray-alpha-200 ${phone ? 'justify-center px-0' : 'pr-2 pl-1.5'}`}>
        {body}
      </span>
    )
  })
  const fillers = phone ? [] : Array.from({ length: Math.max(0, TRACKS - slots.length) }, (_, i) => <span key={`f${i}`} aria-hidden className="border-l border-gray-alpha-200" />)
  return (
    <>
      <div
        role="row"
        aria-label={`${code} ${primary}`}
        data-row={index}
        data-episode={episode.id}
        data-monitored={off ? 'off' : 'on'}
        data-menu-open={menuOpen ? '' : undefined}
        data-selected={ticked ? '' : undefined}
        aria-current={found ? 'true' : undefined}
        tabIndex={tabbable ? 0 : -1}
        onFocus={(e) => e.target === e.currentTarget && onFocus()}
        style={grid.style}
        className={`group/row ${grid.className} min-h-12 border-t border-gray-alpha-100 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-color) ${
          found ? 'bg-blue-alpha-100 ring-2 ring-blue-700 ring-inset' : ticked ? 'bg-gray-alpha-200' : 'bg-gray-alpha-100'
        }`}
      >
        <span role="rowheader" className={`flex min-w-0 items-center gap-2.5 py-1.5 ${phone ? 'gap-1.5 pr-1 pl-7' : 'pr-2 pl-5'}`}>
          {(!phone || actions.selection.active) && <EpisodeTick actions={actions} episode={episode} tabIndex={-1} onFocus={onFocus} />}
          <span className={`label-12-mono shrink-0 ${dim ? 'opacity-75' : ''} ${phone ? '' : 'w-[26px]'}`}>E{String(episode.number).padStart(2, '0')}</span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className={`label-13 min-w-0 truncate ${dim ? 'text-gray-700 opacity-75' : ''}`}>
              <EpisodeName episode={episode} />
            </span>
            {!phone && <span className={`label-12 text-gray-900 ${dim ? 'opacity-75' : ''}`}>{episode.air_date ? airedText(episode.air_date) : '—'}</span>}
          </span>
        </span>
        {cells}
        {fillers}
        <span role="cell" className="flex items-center justify-end border-l border-gray-alpha-200 pr-2 max-sm:border-l-0 max-sm:pr-0.5">
          <EpisodeMenu actions={actions} episode={episode} onOpenChange={setMenuOpen} />
        </span>
      </div>
      <RowDeleteConfirm deletes={actions.deletes} at={episodeRow(episode.id)} />
    </>
  )
}

// chrome: domain-visual
import { Button, Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from '@hyprsh/design'
import { ChevronDown, ChevronUp, FileVideo, Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { Episode } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { usePhone } from '../responsive'
import { RowDeleteConfirm } from './DeleteFiles'
import { EpisodeMenu, EpisodeTick, RowSearch, type EpisodeActions } from './EpisodeActions'
import { EndOfPath, EpisodeFilePopover } from './EpisodeFilePopover'
import { EpisodeName } from './EpisodeName'
import { airedText, grabOf, weekdayDay } from './cellDetail'
import { episodeCode, episodeRow } from './episodes'
import { rowActionsShown } from './IconAction'
import { MonitorToggle } from './MonitorToggle'
import { SlotChips, StateDot, type ChipData } from './SlotChip'
import { cellOf, type SlotInfo } from './slots'
import { slotDetail } from './slotDetail'

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
 * per Slot (STD, 4K, ...; the full state in its tooltip). The Slots come from `slots`, any number of them; no Slot has a column.
 * On hover a row shows Search and an open chevron. Click or Enter opens the row in place, one at a time, listing every Slot with
 * its state, file and one action; its ⋯ menu holds Manual Search, Show in Log and Delete Files.
 *
 * It is one grid with a roving focus on the rows: j/k or the arrows move between rows, Enter opens or closes the focused row,
 * Space ticks it, x ticks (X a range), s searches, m opens Manual search, Home and End jump to the first and last row.
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
  const [openId, setOpenId] = useState<number | null>(null)
  const phone = usePhone()
  const { selection } = actions

  // Another season: the cursor starts at its top again and nothing is open.
  const [shownSeason, setShownSeason] = useState(season)
  if (shownSeason !== season) {
    setShownSeason(season)
    setRow(0)
    setOpenId(null)
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
  const toggleOpen = (id: number) => setOpenId((cur) => (cur === id ? null : id))

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const current = episodes[at]
    if (actions.onKey(e, current ?? null)) return
    const go = (r: number) => {
      e.preventDefault()
      e.stopPropagation() // the Library's own j/k/Enter must not also fire
      move(r)
    }
    const onRow = e.target instanceof Element && e.target.matches('tr[data-row]')
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return go(at + 1)
      case 'ArrowUp':
      case 'k':
        return go(at - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(episodes.length - 1)
      case 'Enter':
      case ' ': {
        if (!onRow || !current) return // a button or a tick box does its own
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') toggleOpen(current.id)
        else selection.toggle(current.id, { range: e.shiftKey })
        return
      }
      case 'Escape':
        if (openId !== null) {
          e.preventDefault()
          e.stopPropagation()
          setOpenId(null)
        }
    }
  }

  const ticked = episodes.filter((e) => selection.has(e.id)).length
  const columns = 7

  return (
    <div ref={grid}>
      <TableRoot>
        <Table role="grid" aria-label="Episodes" aria-colcount={columns} stickyHeader onKeyDown={onKeyDown}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9 px-2">
                <Checkbox
                  aria-label={`Tick all of ${season === 0 ? 'Specials' : `Season ${season}`}`}
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
                {slots.map((s) => s.short).join(' · ')}
              </TableHead>
              <TableHead align="right" className="w-17 px-2 max-sm:w-13 max-sm:px-1">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
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
                open={openId === ep.id}
                grabs={grabs}
                actions={actions}
                onFocus={() => setRow(i)}
                onToggleOpen={() => toggleOpen(ep.id)}
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
          <span className="min-w-0 truncate">{fold.expanded ? 'Hide the episodes not aired yet' : foldText(fold.episodes)}</span>
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** The chips of an episode: one per Slot, outlined when the episode is not monitored. */
function chipsOf(episode: Episode, slots: SlotInfo[], grabs: Map<string, QueueItem>): ChipData[] {
  return slots.map((s) => {
    const d = slotDetail(episode, s.key, grabOf(grabs, s.key, episode))
    return { key: s.key, short: s.short, state: episode.monitored ? d.state : cellOf(episode, s.key) ? 'unmonitored' : null, tip: d.tip }
  })
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
  open,
  grabs,
  actions,
  onFocus,
  onToggleOpen,
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
  open: boolean
  grabs: Map<string, QueueItem>
  actions: EpisodeActions
  onFocus: () => void
  onToggleOpen: () => void
}) {
  const code = episodeCode(episode)
  const off = !episode.monitored
  const chips = chipsOf(episode, slots, grabs)
  // A click on the row opens it; the controls inside do their own.
  const onClick = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button, input, a, [role="dialog"]')) return
    onToggleOpen()
  }
  const toggle = (
    <MonitorToggle
      name={code}
      monitored={episode.monitored}
      tabIndex={-1}
      iconSize={phone ? 20 : 16}
      size={phone ? 'small' : 'tiny'}
      onToggle={() => actions.monitor([episode], !episode.monitored)}
      onFocus={(e) => e.currentTarget.closest<HTMLElement>('tr[data-row]')?.focus()}
    />
  )
  const chevron = (
    <Button
      variant="tertiary"
      size="tiny"
      svgOnly
      tabIndex={-1}
      aria-expanded={open}
      aria-label={`${open ? 'Close' : 'Open'} ${code}`}
      title={open ? 'Close' : 'Open'}
      onClick={(e) => {
        e.stopPropagation()
        onToggleOpen()
      }}
    >
      {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
    </Button>
  )
  const shared = {
    'aria-rowindex': rowIndex,
    'data-row': index,
    'data-episode': episode.id,
    'data-open': open ? '' : undefined,
    'data-monitored': off ? 'off' : 'on',
    tabIndex: tabbable ? 0 : -1,
    selected: ticked,
    current: found,
    onFocus: (e: React.FocusEvent) => e.target === e.currentTarget && onFocus(),
    onClick,
    className: `group/row cursor-pointer ${open ? 'bg-gray-100' : off ? 'bg-background-200' : ''}`,
    style: open ? { boxShadow: 'inset 2px 0 0 var(--gray-1000)' } : undefined,
  }
  return (
    <>
      {phone ? (
        <TableRow {...shared} aria-label={`${code} ${episode.primary_name || episode.name}`}>
          <TableCell colSpan={columns} wrap className="px-2 py-2.5">
            <div className="flex items-center gap-1.5">
              <EpisodeTick actions={actions} episode={episode} tabIndex={-1} onFocus={onFocus} />
              <span className="label-12-mono shrink-0 text-gray-900">E{String(episode.number).padStart(2, '0')}</span>
              <span className={`label-14 min-w-0 flex-1 truncate ${off ? 'text-gray-700' : ''}`}>
                <EpisodeName episode={episode} />
              </span>
              {toggle}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-[5px] pl-9">
              <SlotChips chips={chips} max={slots.length} />
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
            <SlotChips chips={chips} max={MAX_CHIPS} />
          </TableCell>
          <TableCell align="right" className="px-2">
            <span className={`flex items-center justify-end gap-1 ${rowActionsShown}`}>
              <RowSearch actions={actions} episode={episode} />
              {chevron}
            </span>
          </TableCell>
        </TableRow>
      )}
      <RowDeleteConfirm deletes={actions.deletes} at={episodeRow(episode.id)} columns={columns} />
      {open && <OpenRow episode={episode} slots={slots} columns={columns} grabs={grabs} actions={actions} />}
    </>
  )
}

/** The opened row: every Slot with its name, state, file (the start of its path cut) or last search, size and one action. */
function OpenRow({ episode, slots, columns, grabs, actions }: { episode: Episode; slots: SlotInfo[]; columns: number; grabs: Map<string, QueueItem>; actions: EpisodeActions }) {
  const code = episodeCode(episode)
  return (
    <TableRow data-detail={episode.id} className="bg-gray-100" style={{ boxShadow: 'inset 2px 0 0 var(--gray-1000)' }}>
      <TableCell colSpan={columns} wrap className="px-3 pb-3 pl-4 max-sm:px-2 sm:pl-[114px]" onKeyDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-end">
          <EpisodeMenu actions={actions} episode={episode} />
        </div>
        <ul aria-label={`Slots of ${code}`} className="flex flex-col">
          {slots.map((s) => {
            const d = slotDetail(episode, s.key, grabOf(grabs, s.key, episode))
            const cell = cellOf(episode, s.key)
            const state = episode.monitored ? d.state : cell ? 'unmonitored' : null
            const tone = state === 'wanted' ? 'text-amber-900' : state === 'downloading' ? 'text-blue-900' : state === 'unmonitored' || state === 'unreleased' ? 'text-gray-700' : ''
            return (
              <li
                key={s.key}
                data-slot-row={s.key}
                className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-gray-alpha-200 py-1.5 text-[13px] sm:grid-cols-[96px_150px_minmax(0,1fr)_72px_64px]"
              >
                <span className="font-medium">{s.name}</span>
                <span className={`flex items-center gap-1.5 ${tone}`}>
                  <StateDot state={state} />
                  {d.text}
                </span>
                <span className="min-w-0 max-sm:col-span-3 max-sm:col-start-1 max-sm:row-start-2">
                  {d.path ? (
                    <EndOfPath path={d.path} />
                  ) : d.note ? (
                    <span className="label-12-mono block truncate text-gray-900" title={d.note}>
                      {d.note}
                    </span>
                  ) : null}
                </span>
                <span className="text-right text-gray-900 max-sm:hidden">{d.size ?? '—'}</span>
                <span className="flex justify-end">
                  {d.action === 'file' && cell?.file ? (
                    <EpisodeFilePopover
                      label={`${code} ${s.name}`}
                      heading={`${code} · ${s.name}`}
                      cell={cell}
                      file={cell.file}
                      trigger={
                        <Button variant="tertiary" size="tiny" svgOnly aria-label={`File details for ${s.name}`} title="File details">
                          <FileVideo aria-hidden className="size-3.5" />
                        </Button>
                      }
                      onUpgrade={() => {
                        const v = actions.versions.find((x) => x.slot === s.key)
                        if (v) actions.manual(v, { season: episode.season, episode_ids: [episode.id] }, code)
                      }}
                    />
                  ) : d.action === 'search' ? (
                    <Button
                      variant="tertiary"
                      size="tiny"
                      svgOnly
                      aria-label={`Search ${s.name}`}
                      title={`Search ${s.name}`}
                      onClick={() => actions.search([episode], code, (ids) => ({ season: episode.season, episode_ids: ids }), s.key)}
                    >
                      <Search aria-hidden className="size-3.5" />
                    </Button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      </TableCell>
    </TableRow>
  )
}

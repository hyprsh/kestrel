// chrome: domain-visual
// The Log's list: one card with a heading per day, each event one row (time, icon, one sentence), routine runs folded into a
// gray row, and one row opened in place. A row's action and its open chevron show on hover or focus.
import { Button, Link } from '@hyprsh/design'
import {
  ArrowDownToLine,
  Ban,
  Brush,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  Dot,
  Download,
  Eye,
  FileCheck,
  FolderInput,
  FolderPen,
  MoveRight,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  User,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { LogEvent } from '../api/log'
import { plural } from '../format'
import { useOpenPlace } from '../place'
import { EventDetail } from './EventDetail'
import { byDay, clock, type Row } from './rows'
import { actionOf, foldSummary, searchParts, sentence, sentenceText, type IconName, type Recovery, type Sentence } from './sentence'

/** The icon of each kind of sentence; a Title's History draws its events with them too. */
export const icons: Record<IconName, LucideIcon> = {
  grab: ArrowDownToLine,
  download: Download,
  done: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  import: FileCheck,
  request: User,
  watch: Eye,
  rename: FolderPen,
  move: MoveRight,
  delete: Trash2,
  refresh: RefreshCw,
  search: Search,
  adoption: FolderInput,
  cleanup: Brush,
  blocklist: Ban,
  event: Dot,
}

const verbTone = { plain: 'text-gray-1000', warning: 'text-amber-900', error: 'text-red-900' } as const
const iconTone = { plain: 'text-gray-900', warning: 'text-amber-700', error: 'text-red-700' } as const
const rowTone = { plain: '', warning: 'shadow-[inset_2px_0_0_var(--amber-700)]', error: 'bg-red-100 shadow-[inset_2px_0_0_var(--red-700)]' } as const

/** How many routine events an opened fold lists before "… N more". */
const FOLD_SHOWN = 5

/** What the list needs to know about the Library and the screen around it. */
export type ListContext = {
  names: ReadonlyMap<number, string>
  onOpenTitle: (id: number) => void
  /** Sets the Log's filter to the kind or the Title of an event. */
  onShowOnly: (e: LogEvent, by: 'kind' | 'title') => void
  /** What a Needs attention event's outage came to, once it cleared; null when it did not or the event is another kind. */
  recovery?: (e: LogEvent) => Recovery | null
}

/** The sentence of one event: the verb in its severity's colour, the Title bold and linking to it, the details muted. */
function SentenceText({ s, titleId, onOpenTitle }: { s: Sentence; titleId?: number | null; onOpenTitle: (id: number) => void }) {
  return (
    <>
      <span className={verbTone[s.severity]}>{s.verb}</span>
      {s.title && (
        <>
          {' '}
          {titleId != null ? (
            <Link as="button" className="pointer-events-auto relative z-[1] font-semibold" onClick={() => onOpenTitle(titleId)}>
              {s.title}
            </Link>
          ) : (
            <b>{s.title}</b>
          )}
        </>
      )}
      {s.rest && <span className="text-gray-900"> {s.rest}</span>}
    </>
  )
}

function EventRow({
  e,
  nav,
  selected,
  open,
  phone,
  ctx,
  onToggle,
  onSelect,
}: {
  e: LogEvent
  nav: number
  selected: boolean
  open: boolean
  phone: boolean
  ctx: ListContext
  onToggle: () => void
  onSelect: () => void
}) {
  const goTo = useOpenPlace()
  const title = ctx.names.get(e.title_id ?? -1)
  const s = sentence(e, title, ctx.recovery?.(e))
  const Icon = icons[s.icon]
  const action = actionOf(e)
  const ChevronIcon = open ? ChevronUp : ChevronDown
  const tone = rowTone[s.severity]
  return (
    <li
      data-row={e.id}
      data-nav={`log-${nav}`}
      aria-current={selected || undefined}
      className={`group relative border-b border-gray-alpha-200 text-[13px] ${tone} ${open && s.severity !== 'error' ? 'bg-gray-100 shadow-[inset_2px_0_0_var(--gray-1000)]' : ''} ${selected && !tone && !open ? 'bg-gray-alpha-100' : ''}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Close' : 'Open'} event: ${sentenceText(s)}`}
        className="absolute inset-0 w-full cursor-pointer bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2"
        onClick={() => {
          onSelect()
          onToggle()
        }}
      />
      <div className={`pointer-events-none relative grid items-center gap-x-3 px-4 py-[9px] ${phone ? 'grid-cols-[18px_minmax(0,1fr)_auto] items-start' : 'grid-cols-[56px_20px_minmax(0,1fr)_auto]'}`}>
        {!phone && <span className="label-12-mono tabular text-gray-900">{clock(e.at)}</span>}
        <Icon aria-hidden className={`size-4 ${iconTone[s.severity]}`} />
        <span className={`min-w-0 ${phone || open ? 'break-words' : 'truncate'}`}>
          <SentenceText s={s} titleId={title ? e.title_id : null} onOpenTitle={ctx.onOpenTitle} />
        </span>
        {phone ? (
          <span className="label-12-mono tabular text-gray-900">{clock(e.at)}</span>
        ) : (
          <span className="flex items-center gap-1">
            {action && !open && (
              <Button
                variant="tertiary"
                size="tiny"
                className="pointer-events-auto relative z-[1] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => ('title' in action ? ctx.onOpenTitle(action.title) : goTo(action.path))}
              >
                {action.label}
              </Button>
            )}
            <ChevronIcon aria-hidden className={`size-4 text-gray-900 ${open ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`} />
          </span>
        )}
      </div>
      {open && <EventDetail e={e} title={title} onShowOnly={(by) => ctx.onShowOnly(e, by)} onOpenTitle={ctx.onOpenTitle} />}
    </li>
  )
}

/** One routine event inside an opened fold, in a line. */
function CompactEvent({ e, ctx }: { e: LogEvent; ctx: ListContext }) {
  const title = ctx.names.get(e.title_id ?? -1)
  const Icon = icons[sentence(e, title).icon]
  const search = e.kind === 'search'
  const s = sentence(e, title)
  return (
    <li className="grid grid-cols-[56px_20px_minmax(0,1fr)] items-center gap-x-3 px-4 py-1.5 text-[13px] text-gray-900 max-sm:grid-cols-[18px_minmax(0,1fr)_auto]">
      <span className="label-12-mono tabular max-sm:order-3">{clock(e.at)}</span>
      <Icon aria-hidden className="size-3.5 max-sm:order-1" />
      <span className="min-w-0 truncate max-sm:order-2 max-sm:whitespace-normal">
        {search ? (
          <>
            Searched {title && <b className="text-gray-1000">{title}</b>} {searchParts(e).join(' · ')}
          </>
        ) : (
          <>
            {s.verb} {title && <b className="text-gray-1000">{title}</b>} {s.rest}
          </>
        )}
      </span>
    </li>
  )
}

function FoldRow({
  events,
  phone,
  shownAll,
  open,
  ctx,
  nav,
  selected,
  onToggle,
  onShowAll,
  onSelect,
}: {
  events: readonly LogEvent[]
  phone: boolean
  shownAll: boolean
  open: boolean
  ctx: ListContext
  nav: number
  selected: boolean
  onToggle: () => void
  onShowAll: () => void
  onSelect: () => void
}) {
  const Chevrons = open ? ChevronsDownUp : ChevronsUpDown
  const shown = open ? (shownAll ? events : events.slice(0, FOLD_SHOWN)) : []
  return (
    <li data-row={events[0].id} data-nav={`log-${nav}`} aria-current={selected || undefined} className="border-b border-gray-alpha-200 bg-background-200 text-[13px] text-gray-900">
      <div className={`grid items-center gap-x-3 px-4 py-2 ${selected ? 'bg-gray-alpha-100' : ''} ${phone ? 'grid-cols-[18px_minmax(0,1fr)_auto]' : 'grid-cols-[56px_20px_minmax(0,1fr)_auto]'}`}>
        {!phone && <span className="label-12-mono tabular">{clock(events[0].at)}</span>}
        <Chevrons aria-hidden className="size-4" />
        <span className="min-w-0 truncate max-sm:whitespace-normal">{foldSummary(events)}</span>
        <span className="flex items-center gap-2">
          <Link
            as="button"
            className="label-13"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${plural(events.length, 'routine event')}`}
            onClick={() => {
              onSelect()
              onToggle()
            }}
          >
            {open ? 'Hide' : `Show ${events.length}`}
          </Link>
          {phone && <span className="label-12-mono tabular">{clock(events[0].at)}</span>}
        </span>
      </div>
      {open && (
        <ul className="m-0 list-none p-0 pb-1.5">
          {shown.map((e) => (
            <CompactEvent key={e.id} e={e} ctx={ctx} />
          ))}
          {!shownAll && events.length > FOLD_SHOWN && (
            <li className="flex items-center gap-2 px-4 py-1.5 pl-[104px] text-[13px] max-sm:pl-4">
              <span>… {events.length - FOLD_SHOWN} more</span>
              <Link as="button" onClick={onShowAll}>
                Show All
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** The rows of a page, in a card with a heading per day. `sel` is the keyboard cursor, an index into the page's rows. */
export function EventList({
  rows,
  now,
  sel,
  onSelect,
  open,
  onOpen,
  folds,
  onFolds,
  phone,
  ctx,
  label,
}: {
  rows: readonly Row[]
  now: number
  sel: number
  onSelect: (i: number) => void
  /** The id of the one opened event, and the ids of the opened folds; the Log keeps them so Enter can open the row under the cursor. */
  open: number | null
  onOpen: (id: number | null) => void
  folds: ReadonlySet<number>
  onFolds: (folds: ReadonlySet<number>) => void
  phone: boolean
  ctx: ListContext
  label: string
}) {
  const [all, setAll] = useState<ReadonlySet<number>>(new Set())
  const toggle = (set: ReadonlySet<number>, id: number) => {
    const next = new Set(set)
    if (!next.delete(id)) next.add(id)
    return next
  }
  let nav = 0
  return (
    <div className="overflow-hidden rounded-md shadow-border">
      {byDay(rows, now).map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="label-12 m-0 border-b border-gray-alpha-200 bg-background-200 px-4 py-1.5 font-semibold text-gray-900">{day.label}</h2>
          <ul aria-label={`${label}, ${day.label}`} className="m-0 list-none p-0">
            {day.rows.map((r) => {
              const i = nav++
              return r.type === 'event' ? (
                <EventRow
                  key={r.id}
                  e={r.e}
                  nav={i}
                  selected={i === sel}
                  open={open === r.id}
                  phone={phone}
                  ctx={ctx}
                  onSelect={() => onSelect(i)}
                  onToggle={() => onOpen(open === r.id ? null : r.id)}
                />
              ) : (
                <FoldRow
                  key={r.id}
                  events={r.events}
                  phone={phone}
                  open={folds.has(r.id)}
                  shownAll={all.has(r.id)}
                  ctx={ctx}
                  nav={i}
                  selected={i === sel}
                  onSelect={() => onSelect(i)}
                  onToggle={() => onFolds(toggle(folds, r.id))}
                  onShowAll={() => setAll(toggle(all, r.id))}
                />
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

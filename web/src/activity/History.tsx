// Activity's History section: Imported and Failed Grabs newest first, a card of design Entity rows under each day header.
// A row is the Entity's disclosure row: it opens in place (click or ↵) onto its steps, files and next actions, one at a time.
// On a phone a row is two lines.
// chrome: domain-visual
import { Entity, EntityContent, StatusDot } from '@hyprsh/design'
import type { GrabEntry } from '../api/activity'
import type { components } from '../api/schema.gen'
import type { TitleRow } from '../api/queries'
import { size } from '../library/bits'
import type { RowNav } from '../keys'
import { TitlePoster } from '../poster'
import { usePhone } from '../responsive'
import { cx } from '../ui'
import { GrabDetail } from './GrabDetail'
import type { Entry } from './stages'
import { SlotTag } from '../library/SlotPills'
import { dayName, hhmm, shortWhy, whatOf, whyFailed } from './words'

type BlocklistEntry = components['schemas']['BlocklistEntry']
export type Ended = Extract<Entry, { type: 'grab' | 'blocked' }>

/** When the row's Grab ended: an imported or failed Grab, or the Release blocklisted without a Grab. */
const endedAt = (e: Ended): string => (e.type === 'grab' ? e.grab.updated_at : e.entry.created_at)

/** Day by day, newest first: the rows of each day under its name. */
export function byDay<T extends Ended>(rows: readonly T[], now: number): { day: string; rows: T[] }[] {
  const days: { day: string; rows: T[] }[] = []
  for (const r of rows) {
    const day = dayName(Date.parse(endedAt(r)), now)
    const last = days.at(-1)
    if (last?.day === day) last.rows.push(r)
    else days.push({ day, rows: [r] })
  }
  return days
}

/** The columns of a History row after its time and poster, and of the head: the Entity's own gap is 12px, and a trailing 20px holds its chevron. */
const columns = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_190px_64px_56px] items-center gap-x-3'
const headColumns = 'grid grid-cols-[52px_28px_minmax(0,1fr)_minmax(0,1.6fr)_190px_64px_56px_20px] items-center gap-x-3'

/** The Result cell and its tooltip: a green dot and "Imported", or a red one and "Failed · why". */
function result(e: Ended): { failed: boolean; text: string; why: string } {
  if (e.type === 'blocked') return { failed: true, text: `Failed · ${e.entry.reason}`, why: `Blocklisted: ${e.entry.reason}` }
  const g = e.grab
  if (g.state === 'imported') return { failed: false, text: 'Imported', why: g.blocklist_reason ? `Imported; since blocklisted: ${g.blocklist_reason}` : 'Imported' }
  return { failed: true, text: `Failed · ${shortWhy(g)}`, why: whyFailed(g) }
}

function subjectOf(e: Ended, titles: readonly TitleRow[]) {
  if (e.type === 'grab') {
    const g = e.grab
    return { titleId: g.title_id, hasPoster: g.has_poster, title: g.title || 'Deleted Title', what: whatOf(g), slot: g.slot, release: g.release_name, size: g.size, score: g.score as number | null }
  }
  const b: BlocklistEntry = e.entry
  const t = titles.find((x) => x.id === b.title_id)
  return { titleId: b.title_id, hasPoster: t?.has_poster ?? false, title: t?.title || 'Deleted Title', what: '', slot: null as string | null, release: b.release_name, size: b.size, score: null }
}

export function HistoryRow({
  entry: e,
  titles,
  nav,
  open,
  onToggle,
  onOpenTitle,
  onManualSearch,
}: {
  entry: Ended
  titles: readonly TitleRow[]
  nav: RowNav
  open: boolean
  onToggle: () => void
  onOpenTitle: (id: number) => void
  onManualSearch: (g: GrabEntry) => void
}) {
  const phone = usePhone()
  const s = subjectOf(e, titles)
  const r = result(e)
  const time = hhmm(endedAt(e))
  const dot = <StatusDot state={r.failed ? 'error' : 'success'} label={false} aria-hidden />
  const poster = s.titleId != null ? <TitlePoster id={s.titleId} hasPoster={s.hasPoster} size="xs" /> : <span className="w-7" />
  const slot = s.slot && (
    <>
      {' '}
      <SlotTag slot={s.slot} state={r.failed ? 'wanted' : 'filled'} />
    </>
  )
  const what = (
    <>
      <b>{s.title}</b> <span className="font-normal text-gray-900">{s.what}</span>
      {slot}
    </>
  )
  // The design's row is the disclosure button of a Grab; a blocklisted Release has nothing to open, so it is a plain row.
  // Its right side holds the chevron's width, so the columns line up under the head.
  const shared = {
    'data-nav': `${nav.scope}-${nav.index}`,
    current: nav.index === nav.sel,
  }
  const row = phone ? (
    <EntityContent
      fill
      title={what}
      description={
        <span className={cx('label-12 inline-flex max-w-full items-center gap-1.5', r.failed && 'text-red-900')} title={r.why}>
          {dot}
          <span className="truncate">{e.type === 'grab' && !r.failed ? `Imported · ${size(s.size)}` : r.text}</span>
        </span>
      }
    />
  ) : (
    <EntityContent fill>
      <span className={cx(columns, 'text-[13px]')}>
        <span className="truncate">{what}</span>
        <span className="label-12-mono truncate text-gray-900" title={s.release}>
          {s.release}
        </span>
        <span className={cx('flex min-w-0 items-center gap-1.5', r.failed && 'text-red-900')} title={r.why}>
          {dot}
          <span className="truncate">{r.text}</span>
        </span>
        <span className="text-right tabular-nums">{size(s.size)}</span>
        <span className="text-right tabular-nums text-gray-900">{s.score === null ? '' : s.score.toLocaleString()}</span>
      </span>
    </EntityContent>
  )
  const left = phone ? (
    poster
  ) : (
    <>
      <span className="label-12-mono w-[52px] text-gray-900">{time}</span>
      {poster}
    </>
  )
  const right = phone ? <span className="label-12-mono text-gray-900">{time}</span> : undefined
  if (e.type !== 'grab') {
    return (
      <Entity {...shared} left={left} right={right ?? <span aria-hidden className="w-4" />} onClickCapture={nav.onSelect}>
        {row}
      </Entity>
    )
  }
  return (
    <Entity
      {...shared}
      left={left}
      right={right}
      expanded={open}
      onExpandedChange={onToggle}
      onClick={nav.onSelect}
      detail={open ? <GrabDetail grab={e.grab} onOpenTitle={onOpenTitle} onManualSearch={onManualSearch} /> : ''}
    >
      {row}
    </Entity>
  )
}

/** The table header row, wide screens only. */
export function HistoryHead() {
  return (
    <div aria-hidden className={cx(headColumns, 'label-12 px-4 text-gray-900 max-sm:hidden')}>
      <span>Time</span>
      <span />
      <span>Title</span>
      <span>Release</span>
      <span>Result</span>
      <span className="text-right">Size</span>
      <span className="text-right">Score</span>
      <span />
    </div>
  )
}

export function DayHeader({ day }: { day: string }) {
  return <h3 className="label-12 m-0 px-4 font-semibold text-gray-900">{day}</h3>
}

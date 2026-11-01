// Activity's History section: Imported and Failed Grabs newest first as one table card under day headers. A row opens in
// place (click or ↵) onto its steps, files and next actions; one is open at a time. On a phone a row is two lines.
// chrome: domain-visual
import { StatusDot } from '@hyprsh/design'
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

const columns = 'sm:grid sm:grid-cols-[52px_28px_minmax(0,1.1fr)_minmax(0,1fr)_150px_64px_56px] sm:items-center sm:gap-x-3.5'

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
    return { titleId: g.title_id, hasPoster: g.has_poster, title: g.title || 'Deleted Title', what: whatOf(g), release: g.release_name, size: g.size, score: g.score as number | null }
  }
  const b: BlocklistEntry = e.entry
  const t = titles.find((x) => x.id === b.title_id)
  return { titleId: b.title_id, hasPoster: t?.has_poster ?? false, title: t?.title || 'Deleted Title', what: '', release: b.release_name, size: b.size, score: null }
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
  const opens = e.type === 'grab'
  const dot = <StatusDot state={r.failed ? 'error' : 'success'} label={false} aria-hidden />
  const head = phone ? (
    <>
      <span className="flex items-center gap-3">
        {s.titleId != null ? <TitlePoster id={s.titleId} hasPoster={s.hasPoster} size="xs" /> : <span className="w-7" />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="label-14 truncate">
            <b>{s.title}</b> <span className="text-gray-900">{s.what}</span>
          </span>
          <span className={cx('label-12 flex items-center gap-1.5', r.failed && 'text-red-900')} title={r.why}>
            {dot}
            <span className="truncate">{e.type === 'grab' && !r.failed ? `Imported · ${size(s.size)}` : r.text}</span>
          </span>
        </span>
        <span className="label-12-mono shrink-0 text-gray-900">{time}</span>
      </span>
    </>
  ) : (
    <span className={cx(columns, 'text-[13px]')}>
      <span className="label-12-mono text-gray-900">{time}</span>
      {s.titleId != null ? <TitlePoster id={s.titleId} hasPoster={s.hasPoster} size="xs" /> : <span className="w-7" />}
      <span className="truncate">
        <b>{s.title}</b> <span className="text-gray-900">{s.what}</span>
      </span>
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
  )
  return (
    <li
      aria-current={nav.index === nav.sel ? 'true' : undefined}
      data-nav={`${nav.scope}-${nav.index}`}
      className={cx(
        'border-b border-gray-alpha-200 last:border-b-0',
        open && (r.failed ? 'bg-red-100 shadow-[inset_2px_0_0_var(--red-700)]' : 'bg-gray-100 shadow-[inset_2px_0_0_var(--gray-1000)]'),
        !open && nav.index === nav.sel && 'bg-gray-alpha-100',
      )}
    >
      {opens ? (
        <button type="button" aria-expanded={open} className="block w-full px-4 py-2 text-left" onClick={() => (nav.onSelect(), onToggle())}>
          {head}
        </button>
      ) : (
        <div className="px-4 py-2" onClick={nav.onSelect}>
          {head}
        </div>
      )}
      {open && e.type === 'grab' && <GrabDetail grab={e.grab} onOpenTitle={onOpenTitle} onManualSearch={onManualSearch} />}
    </li>
  )
}

/** The table header row, wide screens only. */
export function HistoryHead() {
  return (
    <div aria-hidden className={cx(columns, 'label-12 border-b border-gray-alpha-200 bg-background-200 px-4 py-2 text-gray-900 max-sm:hidden')}>
      <span>Time</span>
      <span />
      <span>Title</span>
      <span>Release</span>
      <span>Result</span>
      <span className="text-right">Size</span>
      <span className="text-right">Score</span>
    </div>
  )
}

export function DayHeader({ day }: { day: string }) {
  return <h3 className="label-12 border-b border-gray-alpha-200 bg-background-200 px-4 py-1.5 font-semibold text-gray-900">{day}</h3>
}

// How far a search pass has got, drawn like a download row: a poster, what is searched now, a Progress bar with the
// count and the time left, and the Releases checked and Grabs so far. Between passes, what waits and how the last one went.
// Activity's Searching stage, the Search job on Health and the "Search all Wanted" Toast all read it.
import { Link, Progress } from '@hyprsh/design'
import type { SearchStatus } from '../api/search'
import { plural } from '../format'
import { TitlePoster } from '../poster'
import { clockTime, span, until, useNow } from '../time'

type Pass = NonNullable<SearchStatus['pass']>
type Last = NonNullable<SearchStatus['last_pass']>

/** What a pass is working through: the Wanted Versions first, then the Upgrade searches. */
export function phaseOf(p: Pass) {
  const upgrades = p.done >= p.total && p.upgrades_total > 0
  return upgrades ? { name: 'Upgrades', done: p.upgrades_done, total: p.upgrades_total, ofLabel: 'Upgrades' } : { name: 'Wanted', done: p.done, total: p.total, ofLabel: 'Wanted' }
}

/** "418 releases checked · 1 Grab so far". */
export const releasesLine = (releases: number, grabs: number, tail = '') => `${plural(releases, 'release')} checked · ${plural(grabs, 'Grab')}${tail}`

/** "about 4 min left" from the rate since the pass began, or null until two items are done. */
function timeLeft(p: Pass, now: number): string | null {
  const phase = phaseOf(p)
  const done = p.done + p.upgrades_done
  if (done < 2 || phase.total <= phase.done) return null
  const per = (now - Date.parse(p.started_at)) / done
  return per > 0 ? `about ${span(per * (phase.total - phase.done))} left` : null
}

/** "Breaking Bad · S05 · Standard": what is searched now, from the Title's name to its Slot. */
function nowParts(c: NonNullable<Pass['current']>): string[] {
  const where =
    c.season != null ? `S${String(c.season).padStart(2, '0')}` : c.episodes.length > 0 ? c.episodes.slice(0, 3).join(', ') + (c.episodes.length > 3 ? ` +${c.episodes.length - 3}` : '') : null
  return [c.title, where, c.slot].filter((x): x is string => Boolean(x))
}

/** The running pass as one row: the progress of the Wanted Versions, then of the Upgrade searches. */
function SearchPassRow({ pass: p, onOpenTitle }: { pass: Pass; onOpenTitle?: (id: number) => void }) {
  const now = useNow()
  const phase = phaseOf(p)
  const c = p.current
  const left = timeLeft(p, now)
  const nowText = c ? `Now: ${nowParts(c).join(' · ')}` : null
  return (
    <div className="flex items-start gap-3 whitespace-normal" aria-label="Search pass">
      {c && <TitlePoster id={c.title_id} hasPoster={c.has_poster} size="sm" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">Searching {phase.name}</span>
        {nowText && (
          <span className="truncate text-gray-900">
            {c && onOpenTitle ? (
              <Link as="button" onClick={() => onOpenTitle(c.title_id)}>
                {nowText}
              </Link>
            ) : (
              nowText
            )}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Progress value={phase.done} max={Math.max(phase.total, 1)} type="success" height={6} aria-label="Search progress" className="min-w-24 flex-1" />
          <span className="shrink-0 tabular-nums">{[`${phase.done} of ${phase.total} ${phase.ofLabel}`, left].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="text-gray-900">{releasesLine(p.releases_seen, p.grabbed, ' so far')}</span>
      </div>
    </div>
  )
}

/** What waits and when the next pass starts: "12 Wanted waiting · next pass in 5 min". */
function waitingLine(s: SearchStatus, now: number): string {
  return [s.due.versions > 0 ? `${s.due.versions} Wanted waiting` : 'Nothing waiting', s.next_pass_at ? `next pass ${until(s.next_pass_at, now)}` : null].filter(Boolean).join(' · ')
}

/** "12 searched · 418 releases checked · 2 Grabs", the result of a pass without the time. */
export function passResult(l: Last): string {
  return [`${l.searched} searched`, l.upgrades > 0 ? plural(l.upgrades, 'Upgrade search', 'Upgrade searches') : null, `${plural(l.releases_seen, 'release')} checked`, plural(l.grabbed, 'Grab')]
    .filter(Boolean)
    .join(' · ')
}

/** "Last pass 11:33 PM: 12 searched · 418 releases checked · 2 Grabs · took 3 min", or null before the first pass. */
function lastPassLine(s: SearchStatus): string | null {
  const l = s.last_pass
  return l ? `Last pass ${clockTime(l.finished_at)}: ${passResult(l)} · took ${span(l.duration_ms)}` : null
}

/** The search pipeline as the Search job shows it: the running row, or between passes the waiting and last-pass lines. */
export function SearchProgress({ status: s, onOpenTitle }: { status: SearchStatus; onOpenTitle?: (id: number) => void }) {
  const now = useNow()
  const last = lastPassLine(s)
  return (
    <div className="flex flex-col gap-1 whitespace-normal">
      {s.pass && <SearchPassRow pass={s.pass} onOpenTitle={onOpenTitle} />}
      <div>{waitingLine(s, now)}</div>
      {!s.pass && last && <div>{last}</div>}
    </div>
  )
}

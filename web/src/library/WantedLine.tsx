// What a Wanted Version says of its search: "Last searched 2 h ago · 23 releases, none fit the Profile · Why? · next search in 4 h",
// and the "Why is it Wanted?" popover that "Why?" and the Version's menu open. The facts are the Version's `last_search` and
// `next_search_at`; a Version that was never searched says so rather than guess.
import { Link, Popover, Button } from '@hyprsh/design'
import { Fragment } from 'react'
import type { components } from '../api/schema.gen'
import type { TitleDetail } from '../api/queries'
import { plural } from '../format'
import { ago, until } from '../time'

type Version = TitleDetail['versions'][number]
type LastSearch = components['schemas']['LastSearch']
type RejectionCount = components['schemas']['RejectionCount']

const codeWords: Record<string, string> = {
  below_min_score: 'below the cutoff',
  resolution: 'the wrong resolution',
  quality: 'a quality the Profile does not take',
  language: 'in the wrong language',
  original_language_unknown: 'with an unknown original language',
  blocklisted: 'blocklisted',
  other_slot: 'for another Slot',
  episode_not_listed: 'naming an unlisted episode',
  season_not_listed: 'naming an unlisted season',
  original_only: 'in the original language only',
  size: 'outside the size limit',
}

/** One rejection group as words: "23 German only", "6 below the cutoff". */
function reasonText(r: RejectionCount): string {
  if (r.code === 'language' && r.detail) return `${r.count} ${r.detail} only`
  return `${r.count} ${codeWords[r.code] ?? r.code.replaceAll('_', ' ')}`
}

/** How a search ended, after "23 releases": "none fit the Profile". */
function endText(ls: LastSearch): string {
  switch (ls.outcome) {
    case 'grabbed':
      return ls.releases > 0 ? `${plural(ls.releases, 'release')}, grabbed one` : 'grabbed one'
    case 'no_indexer':
      return 'no indexer is turned on'
    case 'error':
      return 'the search failed'
    default:
      if (ls.releases === 0) return 'no releases came back'
      return `${plural(ls.releases, 'release')}, ${ls.upgrade ? 'none better' : 'none fit the Profile'}`
  }
}

/** "Last searched 2 h ago · 23 releases, none fit the Profile", or that it was not searched yet. */
function lastSearchedText(v: Version, now: number): string {
  const ls = v.last_search
  return ls ? `Last searched ${ago(ls.at, now)} · ${endText(ls)}` : 'Not searched yet'
}

/** "next search in 4 h", "next search any moment"; null when none is due. */
function nextSearchText(v: Version, now: number): string | null {
  return v.next_search_at ? `next search ${until(v.next_search_at, now)}` : null
}

const days = (since: string | null | undefined, now: number) => (since ? Math.floor((now - new Date(since).getTime()) / 86_400_000) : 0)

/** What a Wanted Version lacks: a Movie's file, or a Series' episodes. */
function lacksText(v: Version): string {
  const c = v.coverage
  if (c) return `${plural(c.wanted, 'episode')} ${c.wanted === 1 ? 'has' : 'have'} no file, or a file that no longer fits the Profile.`
  return v.file ? 'Its file no longer fits the Profile.' : 'It has no file.'
}

/**
 * The line under a Wanted Version's state. `open` and `onOpenChange` let the Version's menu open the popover too. The
 * popover's own "Why?" link is its trigger.
 */
export function WantedLine({
  version: v,
  now,
  open,
  onOpenChange,
  onSearch,
  onManualSearch,
  searching,
}: {
  version: Version
  now: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: () => void
  onManualSearch: () => void
  searching: boolean
}) {
  const next = nextSearchText(v, now)
  return (
    <span className="label-13 text-gray-900">
      {lastSearchedText(v, now)} ·{' '}
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        label="Why is it Wanted?"
        position="bottom-start"
        width={340}
        trigger={
          <Link as="button" type="button">
            Why?
          </Link>
        }
      >
        {({ close }) => <WhyWanted version={v} now={now} onSearch={() => (close(), onSearch())} onManualSearch={() => (close(), onManualSearch())} searching={searching} />}
      </Popover>
      {next && ` · ${next}`}
    </span>
  )
}

/** The body of "Why is it Wanted?": the state, since when, the last search with its main rejection reasons, and the next search. */
function WhyWanted({ version: v, now, onSearch, onManualSearch, searching }: { version: Version; now: number; onSearch: () => void; onManualSearch: () => void; searching: boolean }) {
  const ls = v.last_search
  const since = v.wanted_since
  const d = days(since, now)
  const rows: [string, string][] = [['State', lacksText(v)]]
  if (since)
    rows.push([
      v.long_missing ? 'Long Missing' : 'Since',
      d >= 1 ? `Wanted for ${plural(d, 'day')}, since ${new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Just became Wanted',
    ])
  rows.push(['Last search', ls ? `${ago(ls.at, now)}: ${endText(ls)}` : 'None yet'])
  if (ls && ls.reasons.length > 0) rows.push(['Rejected', ls.reasons.slice(0, 3).map(reasonText).join(' · ')])
  rows.push([
    'Next search',
    v.next_search_at
      ? until(v.next_search_at, now)
          .replace(/^in /, 'In ')
          .replace(/^any moment$/, 'Any moment')
      : 'None is due',
  ])
  return (
    <div className="flex flex-col gap-2.5" onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}>
      <p className="label-14-strong">Why is it Wanted?</p>
      <dl className="label-13 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-1">
        {rows.map(([k, text]) => (
          <Fragment key={k}>
            <dt className="text-gray-900">{k}</dt>
            <dd>{text}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="label-12 text-gray-900">Kestrel searches again on its own: a day, three days and seven days after it became Wanted, then weekly.</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="small" disabled={searching} onClick={onSearch}>
          Search Now
        </Button>
        <Button variant="tertiary" size="small" onClick={onManualSearch}>
          Manual Search…
        </Button>
      </div>
    </div>
  )
}

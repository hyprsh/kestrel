// The Log: what Kestrel did, as a strip of the last days over one card of events as sentences, filtered by one field of
// qualifiers (kind:, slot:, title:, routine:) and free text; and the Blocklist view, where an entry can be removed.
import { Button, DotsMenu, EmptyState, Entity, MenuDivider, MenuItem, MenuSection, NavItem, Note, Pager, Skeleton, Table, Toggle, parseQuery, withValue } from '@hyprsh/design'
import { ArrowDownToLine, CircleAlert, FileCheck, FolderInput, List, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBlocklist, useEventsHistogram, useEventsSummary, useSameKind, useUnblock, type EventsSummary, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../fuzzy'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import type { Facet } from '../filter/qualifiers'
import { FacetFilterButton, SortButton } from '../layout/FilterButton'
import { FilterChips, SidePanel, SidePanelViews } from '../layout/SidePanel'
import { PagerStrip } from '../layout/PagerStrip'
import { useKey, useListNav } from '../keys'
import { SkeletonRows, TableSkeletonRows } from '../loading'
import { usePageParam } from '../place'
import { plural } from '../format'
import { reasonWords } from '../rejection'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { useReport } from '../toasts'
import { EventList } from './EventList'
import { useFeed, useFollowLive } from './feed'
import { useSlotNames } from '../library/slots'
import { currentView, kindLabels, logFilter, logQualifiers, logViews, oldestFirst, refinements, viewCount, viewQuery } from './filter'
import { foldRows, type Row } from './rows'
import { recoveriesByKey, recoveryAfter } from './sentence'
import { Strip, stripTotals } from './Strip'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const viewIcons: Record<string, ReactNode> = {
  everything: <List />,
  errors: <CircleAlert />,
  warnings: <TriangleAlert />,
  grabs: <ArrowDownToLine />,
  imports: <FileCheck />,
  adoption: <FolderInput />,
  searches: <Search />,
}

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Log({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const [blocklist, setBlocklist] = useState(false)
  const [, setPage] = usePageParam()
  // The Blocklist is a page of its own, reached from the "…" menu; any view of the panel goes back to the Log.
  const showBlocklist = (on: boolean) => {
    setBlocklist(on)
    setPage(1)
  }
  return blocklist ? (
    <Blocklist
      query={query}
      onQuery={onQuery}
      onBack={() => showBlocklist(false)}
      onView={(q) => {
        onQuery(q)
        showBlocklist(false)
      }}
    />
  ) : (
    <Events query={query} onQuery={onQuery} onOpenTitle={onOpenTitle} onBlocklist={() => showBlocklist(true)} />
  )
}

/** The footer line: how far back the Log goes, and how long routine events are kept; what is not known is left out. */
function retention(summary: EventsSummary | undefined, now: number): string | null {
  if (!summary) return null
  const parts = []
  if (summary.oldest) {
    const days = Math.max(1, Math.ceil((now - new Date(summary.oldest).getTime()) / 86_400_000))
    parts.push(days === 1 ? 'Today' : `Last ${days} days`)
  }
  if (summary.routine_days > 0) parts.push(`routine kept ${summary.routine_days} days`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The strip's days: the time range the Log covers, up to a week. */
function stripDays(summary: EventsSummary | undefined, now: number): number {
  if (!summary?.oldest) return 7
  return Math.min(7, Math.max(1, Math.ceil((now - new Date(summary.oldest).getTime()) / 86_400_000)))
}

/** The histogram behind the strip and a phone's week line. */
function useStrip() {
  const now = useNow()
  const days = stripDays(useEventsSummary().data, now)
  return { days, now, histogram: useEventsHistogram(days) }
}

/** A phone's week line: "874 events this week · 3 errors · 12 warnings", the errors in red. */
function WeekLine() {
  const { days, histogram } = useStrip()
  if (!histogram.data) return <Skeleton width={240} height={14} />
  const t = stripTotals(histogram.data.buckets)
  const span = days >= 7 ? 'this week' : days <= 1 ? 'today' : `in the last ${days} days`
  return (
    <span className="label-12 text-gray-900">
      {plural(t.events, 'event')} {span} · <span className={t.errors > 0 ? 'text-red-900' : undefined}>{plural(t.errors, 'error')}</span> · {plural(t.warnings, 'warning')}
    </span>
  )
}

/**
 * The Log's side panel, shared by its two pages: the name with the "…" menu, the filter, Filter and Sort, the chips, the
 * Views and the footer with the Follow live switch. The Blocklist shows only the name, the menu and the Views, since its list is not filtered.
 * On a phone the Views are in the filter menu with the filter's own sections, and the sort and Follow live in the "…" menu,
 * since the panel is only a header there.
 */
function LogPanel({
  query,
  onQuery,
  onView,
  qualifiers,
  filtered,
  onFilter,
  blocklist,
  onBlocklist,
  follow,
}: {
  query: string
  onQuery: (query: string) => void
  /** Chooses a view: its filter, as the new query. */
  onView: (query: string) => void
  qualifiers: readonly Facet[]
  /** Whether the list can be filtered (the Log, not the Blocklist). */
  filtered: boolean
  onFilter?: ReactNode
  blocklist: { showing: boolean; onBack: () => void } | { showing: false; onBack?: undefined }
  onBlocklist?: () => void
  /** Follow live and how to set it; the Blocklist has none. */
  follow?: [boolean, (on: boolean) => void]
}) {
  const phone = usePhone()
  const summary = useEventsSummary()
  const counts = summary.data?.counts
  const chosen = blocklist.showing ? undefined : currentView(query, qualifiers)
  const countOf = (v: (typeof logViews)[number]) => (counts ? viewCount(v, counts) : undefined)
  const now = useNow()
  const foot = retention(summary.data, now)
  const sort = parseQuery(query, qualifiers).terms.some((t) => t.name === 'sort' && t.values[0] === 'oldest') ? 'oldest' : ''
  const setSort = (value: string) => {
    const terms = parseQuery(query, qualifiers).terms
    let text = query
    for (let i = terms.length - 1; i >= 0; i--) if (terms[i].name === 'sort') text = text.slice(0, terms[i].span[0]) + text.slice(terms[i].span[1])
    text = text.replace(/\s+/g, ' ').trim()
    onQuery(value ? withValue(text, 'sort', value, qualifiers) : text)
  }
  const viewItems = logViews.map((v) => (
    <MenuItem key={v.key} role="radio" checked={chosen?.key === v.key} suffix={countOf(v)?.toLocaleString()} onSelect={() => onView(viewQuery(v, query, qualifiers))}>
      {v.label}
    </MenuItem>
  ))
  return (
    <SidePanel
      title="Log"
      actions={
        <DotsMenu aria-label="Log actions" width={220}>
          {blocklist.showing ? <MenuItem onSelect={blocklist.onBack}>Back to the Log</MenuItem> : <MenuItem onSelect={() => onBlocklist?.()}>Blocklist</MenuItem>}
          {phone && !blocklist.showing && (
            <>
              <MenuDivider />
              <MenuSection title="Sort">
                <MenuItem role="radio" checked={sort === ''} onSelect={() => setSort('')}>
                  Newest First
                </MenuItem>
                <MenuItem role="radio" checked={sort === 'oldest'} onSelect={() => setSort('oldest')}>
                  Oldest First
                </MenuItem>
              </MenuSection>
              {follow && (
                <>
                  <MenuDivider />
                  <MenuItem role="checkbox" checked={follow[0]} onSelect={() => follow[1](!follow[0])}>
                    Follow Live
                  </MenuItem>
                </>
              )}
            </>
          )}
          {phone && blocklist.showing && (
            <>
              <MenuDivider />
              <MenuSection title="Views">{viewItems}</MenuSection>
            </>
          )}
        </DotsMenu>
      }
      filter={filtered ? onFilter : undefined}
      controls={
        filtered ? (
          phone ? (
            <FacetFilterButton
              query={query}
              onQuery={onQuery}
              qualifiers={qualifiers}
              active={refinements(query, qualifiers)}
              label="Views and Filter"
              lead={<MenuSection title="Views">{viewItems}</MenuSection>}
            />
          ) : (
            <>
              <FacetFilterButton query={query} onQuery={onQuery} qualifiers={qualifiers} active={refinements(query, qualifiers)} />
              <SortButton query={query} onQuery={onQuery} qualifiers={qualifiers} />
            </>
          )
        ) : undefined
      }
      chips={
        filtered ? (
          <>
            <FilterChips chips={filterChips(query, onQuery, qualifiers)} />
            {phone && <WeekLine />}
          </>
        ) : undefined
      }
      views={
        <SidePanelViews>
          {logViews.map((v) => {
            const n = countOf(v)
            return (
              <NavItem
                key={v.key}
                icon={viewIcons[v.key]}
                current={chosen?.key === v.key ? 'true' : false}
                trailing={n === undefined ? undefined : v.key === 'errors' && n > 0 ? <span className="label-12 tabular-nums text-red-900">{n.toLocaleString()}</span> : n}
                trailingLabel={n === undefined ? undefined : n.toLocaleString()}
                onClick={() => onView(viewQuery(v, query, qualifiers))}
              >
                {v.label}
              </NavItem>
            )
          })}
        </SidePanelViews>
      }
      footer={
        follow || foot ? (
          <div className="flex w-full flex-col gap-2">
            {follow && (
              <Toggle size="small" checked={follow[0]} onChange={follow[1]} labelCasing="normal" direction="switch-first">
                Follow Live
              </Toggle>
            )}
            {foot && <span>{foot}</span>}
          </div>
        ) : undefined
      }
    />
  )
}

/** Events per page. */
const PAGE_SIZE = 50

/** The Blocklist's two columns. */
const blockColumns = [
  { key: 'release', header: 'Release', mono: true, truncate: true },
  { key: 'actions', header: 'Actions', numeric: true },
]

function useTitleNames() {
  const titles = useTitles().data
  return useMemo(() => ({ list: titles, names: new Map((titles ?? []).map((t) => [t.id, t.title])) }), [titles])
}

function Events({ query, onQuery, onOpenTitle, onBlocklist }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void; onBlocklist: () => void }) {
  const phone = usePhone()
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [folds, setFolds] = useState<ReadonlySet<number>>(new Set())
  const [follow, setFollow] = useFollowLive()
  const { list: titles, names } = useTitleNames()
  const slots = useSlotNames()
  const qualifiers = useMemo(() => logQualifiers(kindLabels, [...new Set((titles ?? []).map((t) => t.title))], slots), [titles, slots])
  const parsed = useMemo(() => parseQuery(query, qualifiers), [query, qualifiers])
  const byTitle = parsed.terms.some((t) => t.name === 'title')
  // A title: filter names Titles, so it waits for the Library to know which.
  const feed = useFeed(logFilter(parsed, titles ?? []), !byTitle || titles !== undefined, follow)
  const strip = useStrip()
  // A Needs attention row that closed again says how often Kestrel retried and when the connection came back; asked only when the Log shows one.
  const cleared = useSameKind((feed.events ?? []).some((e) => e.kind === 'health_raised') ? 'health_cleared' : undefined)
  const recoveries = useMemo(() => recoveriesByKey(cleared.data ?? []), [cleared.data])
  const recovery = (e: LogEvent) => (e.kind === 'health_raised' ? recoveryAfter(e, recoveries) : null)

  const [page, setPage] = usePageParam()
  const oldest = oldestFirst(parsed)
  const matching = useMemo(() => (feed.events ?? []).filter((e) => matchText(parsed.text, [e.message, names.get(e.title_id ?? -1) ?? ''])), [feed.events, parsed.text, names])
  const rows = useMemo(() => foldRows(oldest ? [...matching].reverse() : matching), [matching, oldest])

  // A page past the last one (a filter that shrank the list, a stale address) shows the last page.
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, lastPage)
  const pageRows = useMemo(() => rows.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE), [rows, shownPage])
  const toPage = (next: number) => {
    setPage(next)
    setSel(0)
    setOpen(null)
  }
  // A new filter starts at the first page.
  const filterTo = (q: string) => {
    setPage(1)
    setSel(0)
    setOpen(null)
    onQuery(q)
  }

  // Reaching the last page loads the events before it (newest first only: the oldest-first order shows the loaded ones turned round).
  useEffect(() => {
    if (!oldest && feed.more && !feed.loadingOlder && rows.length > 0 && shownPage >= lastPage) feed.loadOlder()
  }, [oldest, feed.more, feed.loadingOlder, feed.loadOlder, rows.length, shownPage, lastPage])

  // A click on the strip: load back to the column's time if the list does not reach it yet, then show the page with the
  // newest event before the end of that time and scroll to it.
  const [jump, setJump] = useState<{ from: number; to: number } | null>(null)
  const [scrollTo, setScrollTo] = useState<number | null>(null)
  useEffect(() => {
    if (!jump || !feed.events) return
    const last = feed.events.at(-1)
    if (last && Date.parse(last.at) > jump.from && feed.more) {
      if (!feed.loadingOlder) feed.loadOlder()
      return
    }
    const target = matching.find((e) => Date.parse(e.at) < jump.to)
    const at = target ? rows.findIndex((r) => (r.type === 'event' ? r.id === target.id : r.events.some((x) => x.id === target.id))) : -1
    setJump(null)
    if (at < 0) return
    setPage(Math.floor(at / PAGE_SIZE) + 1)
    setSel(at % PAGE_SIZE)
    setScrollTo(rows[at].id)
  }, [jump, feed, matching, rows, setPage])
  useEffect(() => {
    if (scrollTo === null) return
    const el = document.querySelector(`[data-row="${scrollTo}"]`)
    if (!el) return
    el.scrollIntoView?.({ block: 'start' })
    setScrollTo(null)
  }, [scrollTo, pageRows])

  const toggleAt = (row: Row | undefined) => {
    if (!row) return
    if (row.type === 'event') setOpen(open === row.id ? null : row.id)
    else {
      const next = new Set(folds)
      if (!next.delete(row.id)) next.add(row.id)
      setFolds(next)
    }
  }
  const at = Math.min(sel, Math.max(pageRows.length - 1, 0))
  useListNav('log', pageRows.length, at, setSel, (i) => toggleAt(pageRows[i]))
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('log-filter')?.focus()
  })

  const showOnly = (e: { kind: string; title_id?: number | null }, by: 'kind' | 'title') => {
    if (by === 'title') {
      const name = names.get(e.title_id ?? -1)
      if (name) filterTo(withValue(query, 'title', name, qualifiers))
    } else filterTo(viewQuery({ key: 'kind', label: '', terms: `kind:${e.kind}`, kinds: null }, query, qualifiers))
  }

  const panel = (
    <LogPanel
      query={query}
      onQuery={filterTo}
      onView={filterTo}
      qualifiers={qualifiers}
      filtered
      onFilter={<FilterBar id="log-filter" label="Filter the Log" placeholder="Filter, e.g. kind:errors  /" value={query} onChange={filterTo} qualifiers={qualifiers} menus={false} />}
      blocklist={{ showing: false }}
      onBlocklist={onBlocklist}
      follow={[follow, setFollow]}
    />
  )
  const fresh = feed.fresh.count > 0 && (
    <div className="sticky top-2 z-10 flex justify-center">
      <Button
        variant="secondary"
        size="small"
        onClick={() => {
          feed.showFresh()
          toPage(1)
          setScrollTo(null)
          document.getElementById('log-events')?.scrollTo?.({ top: 0 })
        }}
      >
        {`${feed.fresh.count}${feed.fresh.atLeast ? '+' : ''} new ${feed.fresh.count === 1 ? 'event' : 'events'}`}
      </Button>
    </div>
  )
  return (
    <div className={phone ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1'}>
      {panel}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div id="log-events" className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col gap-4 p-4 sm:px-8 sm:py-6">
            {!phone && strip.histogram.data && strip.histogram.data.buckets.length > 0 && (
              <Strip buckets={strip.histogram.data.buckets} days={strip.days} now={strip.now} onJump={(from, to) => setJump({ from: from.getTime(), to: to.getTime() })} />
            )}
            {fresh}
            {feed.isError && <Note variant="error">The Log could not be loaded.</Note>}
            {feed.events && rows.length === 0 && <EmptyState description="Nothing in the Log matches." />}
            {!feed.events && !feed.isError && (
              <div aria-busy>
                <SkeletonRows count={6} label="Loading the Log" />
              </div>
            )}
            {rows.length > 0 && (
              <EventList
                rows={pageRows}
                now={strip.now}
                sel={at}
                onSelect={setSel}
                open={open}
                onOpen={setOpen}
                folds={folds}
                onFolds={setFolds}
                phone={phone}
                label="Events"
                ctx={{ names, onOpenTitle, onShowOnly: showOnly, recovery }}
              />
            )}
          </div>
        </div>
        {rows.length > PAGE_SIZE && (
          <PagerStrip>
            <Pager aria-label="Log pages" page={shownPage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={toPage} />
          </PagerStrip>
        )}
      </div>
    </div>
  )
}

function Blocklist({ query, onQuery, onBack, onView }: { query: string; onQuery: (query: string) => void; onBack: () => void; onView: (query: string) => void }) {
  const phone = usePhone()
  const list = useBlocklist()
  const unblock = useUnblock()
  const report = useReport()
  const remove = (id: number) => void report(unblock.mutateAsync(id), { done: 'Release removed from the Blocklist', failed: 'Could not remove the Release from the Blocklist' })
  const { names } = useTitleNames()
  const [sel, setSel] = useState(0)
  const items = list.data ?? []
  useListNav('block', items.length, sel, setSel)
  const { list: titles } = useTitleNames()
  const slots = useSlotNames()
  const qualifiers = useMemo(() => logQualifiers(kindLabels, [...new Set((titles ?? []).map((t) => t.title))], slots), [titles, slots])

  return (
    <div className={phone ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1'}>
      <LogPanel query={query} onQuery={onQuery} onView={onView} qualifiers={qualifiers} filtered={false} blocklist={{ showing: true, onBack }} />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {list.data && items.length === 0 && (
          <div className="p-4">
            <EmptyState description="The Blocklist is empty." />
          </div>
        )}
        {list.isPending && phone && (
          <div className="p-4">
            <SkeletonRows count={5} label="Loading the Blocklist" />
          </div>
        )}
        {items.length > 0 && phone && (
          <div className="p-4">
            <Entity.List aria-label="Blocklist">
              {items.map((b, i) => (
                <Entity
                  key={b.id}
                  as="button"
                  current={i === sel}
                  data-nav={`block-${i}`}
                  onClick={() => setSel(i)}
                  className="flex-col items-stretch"
                  rightClassName="flex-col items-stretch"
                  right={
                    <Button variant="secondary" size="small" width="100%" aria-label={`Remove ${b.release_name} from the Blocklist`} disabled={unblock.isPending} onClick={() => remove(b.id)}>
                      Remove from the Blocklist
                    </Button>
                  }
                >
                  <div className="min-w-0">
                    <div className="label-12-mono break-all">{b.release_name}</div>
                    <div className="label-13 mt-0.5 text-gray-900">
                      {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                      {reasonWords(b.reason)} · {when(b.created_at)}
                    </div>
                  </div>
                </Entity>
              ))}
            </Entity.List>
          </div>
        )}
        {(items.length > 0 || list.isPending) && !phone && (
          <Table.Root>
            <Table aria-label="Blocklist" aria-busy={list.isPending || undefined}>
              <Table.Colgroup>
                <Table.Col />
                <Table.Col style={{ width: 96 }} />
              </Table.Colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head className="label-12-strong">Release</Table.Head>
                  <Table.Head align="right" className="label-12-strong">
                    <span className="sr-only">Actions</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body bordered interactive>
                {list.isPending && <TableSkeletonRows columns={blockColumns} count={5} />}
                {items.map((b, i) => (
                  <Table.Row key={b.id} data-nav={`block-${i}`} current={i === sel} onClick={() => setSel(i)}>
                    <Table.Cell truncate>
                      <div className="label-12-mono truncate">{b.release_name}</div>
                      <div className="label-13 truncate text-gray-900">
                        {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                        {reasonWords(b.reason)} · {when(b.created_at)}
                      </div>
                    </Table.Cell>
                    <Table.Cell align="right">
                      <Button variant="secondary" size="small" aria-label={`Remove ${b.release_name} from the Blocklist`} disabled={unblock.isPending} onClick={() => remove(b.id)}>
                        Remove
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Table.Root>
        )}
      </div>
    </div>
  )
}

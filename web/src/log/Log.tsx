// The Log: what Kestrel did, filtered by one field of qualifiers (kind:, slot:, title:,
// routine:) and free text, with routine events hidden until asked for; and the Blocklist view,
// where an entry can be removed.
import { Badge, Button, DotsMenu, EmptyState, Entity, Link, MenuDivider, MenuItem, MenuSection, Note, Pager, Table, parseQuery, termText, withValue, type BadgeProps } from '@hyprsh/design'
import { ArrowDownToLine, CircleAlert, FileCheck, FolderInput, List, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useBlocklist, useEvents, useEventsSummary, useUnblock, type EventsSummary, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../fuzzy'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import type { Facet } from '../filter/qualifiers'
import { FacetFilterButton, SortButton } from '../layout/FilterButton'
import { FilterChips, SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
import { PagerStrip } from '../layout/PagerStrip'
import { useKey, useListNav } from '../keys'
import { useColumnWidths } from '../layout/columnWidths'
import { SkeletonRow, SkeletonRows, TableSkeletonRows } from '../loading'
import { usePageParam } from '../place'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { useReport } from '../toasts'
import { currentView, logFilter, logQualifiers, logViews, oldestFirst, refinements, viewCount, viewQuery } from './filter'

type Tone = NonNullable<BadgeProps['variant']>

const kinds: Record<string, { label: string; tone: Tone }> = {
  grab: { label: 'Grabbed', tone: 'blue' },
  grab_failed: { label: 'Failed', tone: 'red' },
  grab_canceled: { label: 'Canceled', tone: 'gray' },
  grab_downloading: { label: 'Downloading', tone: 'gray' },
  grab_completed: { label: 'Downloaded', tone: 'gray' },
  import: { label: 'Imported', tone: 'green' },
  import_episode: { label: 'Episode', tone: 'green' },
  import_rejected: { label: 'Import rejected', tone: 'red' },
  import_stalled: { label: 'Import stalled', tone: 'amber' },
  blocklist: { label: 'Blocklisted', tone: 'red' },
  request: { label: 'Requested', tone: 'teal' },
  request_ended: { label: 'Request ended', tone: 'gray' },
  watch_ahead: { label: 'Watch-ahead', tone: 'teal' },
  rename: { label: 'Renamed', tone: 'gray' },
  move: { label: 'Moved', tone: 'gray' },
  delete: { label: 'Deleted', tone: 'gray' },
  title_refreshed: { label: 'Refreshed', tone: 'gray' },
  search: { label: 'Searched', tone: 'gray' },
  adoption: { label: 'Adopted', tone: 'teal' },
  adoption_scanned: { label: 'Scanned', tone: 'gray' },
  cleanup: { label: 'Cleaned up', tone: 'gray' },
  health_raised: { label: 'Warning', tone: 'amber' },
  health_cleared: { label: 'Cleared', tone: 'green' },
  original_offered: { label: 'Original offered', tone: 'amber' },
}

const kindLabels = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.label]))

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
export function Log({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const [blocklist, setBlocklist] = useState(false)
  const [, setPage] = usePageParam()
  const widths = useColumnWidths('log')
  // The Blocklist is a page of its own, reached from the "…" menu; any view of the panel goes back to the Log.
  const showBlocklist = (on: boolean) => {
    setBlocklist(on)
    setPage(1)
  }
  return blocklist ? (
    <Blocklist
      query={query}
      onQuery={onQuery}
      widths={widths}
      onBack={() => showBlocklist(false)}
      onView={(q) => {
        onQuery(q)
        showBlocklist(false)
      }}
    />
  ) : (
    <Events query={query} onQuery={onQuery} widths={widths} onBlocklist={() => showBlocklist(true)} />
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

/**
 * The Log's side panel, shared by its two pages: the name with the "…" menu, the filter, Filter and Sort, the chips, the
 * Views and the footer. The Blocklist shows only the name, the menu and the Views, since its list is not filtered.
 * On a phone the Views are in the "…" menu, since the panel is only a header there.
 */
function LogPanel({
  query,
  onQuery,
  onView,
  qualifiers,
  filtered,
  onFilter,
  widths,
  blocklist,
  onBlocklist,
}: {
  query: string
  onQuery: (query: string) => void
  /** Chooses a view: its filter, as the new query. */
  onView: (query: string) => void
  qualifiers: readonly Facet[]
  /** Whether the list can be filtered (the Log, not the Blocklist). */
  filtered: boolean
  onFilter?: ReactNode
  widths: ReturnType<typeof useColumnWidths>
  blocklist: { showing: boolean; onBack: () => void } | { showing: false; onBack?: undefined }
  onBlocklist?: () => void
}) {
  const phone = usePhone()
  const summary = useEventsSummary()
  const counts = summary.data?.counts
  const chosen = blocklist.showing ? undefined : currentView(query, qualifiers)
  const countOf = (v: (typeof logViews)[number]) => (counts ? viewCount(v, counts) : undefined)
  const now = useNow()
  const foot = retention(summary.data, now)
  return (
    <SidePanel
      title="Log"
      actions={
        <DotsMenu aria-label="Log actions" width={220}>
          {blocklist.showing ? (
            <MenuItem onSelect={blocklist.onBack}>Back to the Log</MenuItem>
          ) : (
            <>
              {!phone && (
                <MenuItem disabled={widths.isDefault} onSelect={widths.reset}>
                  Reset column widths
                </MenuItem>
              )}
              <MenuItem onSelect={() => onBlocklist?.()}>Blocklist</MenuItem>
            </>
          )}
          {phone && (
            <>
              <MenuDivider />
              <MenuSection title="Views">
                {logViews.map((v) => (
                  <MenuItem key={v.key} role="radio" checked={chosen?.key === v.key} suffix={countOf(v)?.toLocaleString()} onSelect={() => onView(viewQuery(v, query, qualifiers))}>
                    {v.label}
                  </MenuItem>
                ))}
              </MenuSection>
            </>
          )}
        </DotsMenu>
      }
      filter={filtered ? onFilter : undefined}
      controls={
        filtered ? (
          <>
            <FacetFilterButton query={query} onQuery={onQuery} qualifiers={qualifiers} active={refinements(query, qualifiers)} />
            <SortButton query={query} onQuery={onQuery} qualifiers={qualifiers} />
          </>
        ) : undefined
      }
      chips={filtered ? <FilterChips chips={filterChips(query, onQuery, qualifiers)} /> : undefined}
      views={
        <SidePanelViews>
          {logViews.map((v) => {
            const n = countOf(v)
            return (
              <SidePanelView
                key={v.key}
                icon={viewIcons[v.key]}
                current={chosen?.key === v.key}
                count={n === undefined ? undefined : <span className={v.key === 'errors' && n > 0 ? 'text-red-900' : undefined}>{n.toLocaleString()}</span>}
                onSelect={() => onView(viewQuery(v, query, qualifiers))}
              >
                {v.label}
              </SidePanelView>
            )
          })}
        </SidePanelViews>
      }
      footer={foot ? <span>{foot}</span> : undefined}
    />
  )
}

/** What a skeleton row sizes its cells by: the Log's three columns. */
const eventColumns = [
  { key: 'when', header: 'When' },
  { key: 'kind', header: 'Kind' },
  { key: 'event', header: 'Event' },
]

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

function Events({ query, onQuery, widths, onBlocklist }: { query: string; onQuery: (query: string) => void; widths: ReturnType<typeof useColumnWidths>; onBlocklist: () => void }) {
  const phone = usePhone()
  const [sel, setSel] = useState(0)
  const { list: titles, names } = useTitleNames()
  const qualifiers = useMemo(() => logQualifiers(kindLabels, [...new Set((titles ?? []).map((t) => t.title))]), [titles])
  const parsed = useMemo(() => parseQuery(query, qualifiers), [query, qualifiers])
  const byTitle = parsed.terms.some((t) => t.name === 'title')
  // A title: filter names Titles, so it waits for the Library to know which.
  const events = useEvents(logFilter(parsed, titles ?? []), !byTitle || titles !== undefined)

  const [page, setPage] = usePageParam()
  const oldest = oldestFirst(parsed)
  const shown = useMemo(() => {
    const matching = (events.data ?? []).filter((e) => matchText(parsed.text, [e.message, names.get(e.title_id ?? -1) ?? '']))
    return oldest ? matching.reverse() : matching
  }, [events.data, parsed.text, names, oldest])

  // A page past the last one (a filter that shrank the list, a stale address) shows the last page.
  const shownPage = Math.min(page, Math.max(1, Math.ceil(shown.length / PAGE_SIZE)))
  const pageRows = useMemo(() => shown.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE), [shown, shownPage])
  const toPage = (next: number) => {
    setPage(next)
    setSel(0)
  }
  // A new filter starts at the first page.
  const filterTo = (q: string) => {
    setPage(1)
    setSel(0)
    onQuery(q)
  }

  useListNav('log', pageRows.length, Math.min(sel, Math.max(pageRows.length - 1, 0)), setSel)
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('log-filter')?.focus()
  })

  const panel = (
    <LogPanel
      query={query}
      onQuery={filterTo}
      onView={filterTo}
      qualifiers={qualifiers}
      filtered
      onFilter={<FilterBar id="log-filter" label="Filter the Log" placeholder="Filter, e.g. kind:errors  /" value={query} onChange={filterTo} qualifiers={qualifiers} menus={false} />}
      widths={widths}
      blocklist={{ showing: false }}
      onBlocklist={onBlocklist}
    />
  )
  return (
    <div className={phone ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1'}>
      {panel}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {events.isError && <Note variant="error">The Log could not be loaded.</Note>}
          {events.data && shown.length === 0 && (
            <div className="p-4">
              <EmptyState description="Nothing in the Log matches." />
            </div>
          )}
          {phone ? (
            // A phone has no room for three columns: each event is a stacked row, its message wrapping under the kind and the time.
            <div className="p-4">
              <Entity.List aria-label="Events" aria-busy={events.isPending || undefined}>
                {events.isPending && [0, 1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} index={i} />)}
                {pageRows.map((e, i) => (
                  <PhoneEvent
                    key={e.id}
                    e={e}
                    index={i}
                    sel={sel}
                    onSelect={() => setSel(i)}
                    title={names.get(e.title_id ?? -1)}
                    onFilter={(name, value) => filterTo(withValue(query, name, value, qualifiers))}
                  />
                ))}
              </Entity.List>
            </div>
          ) : (
            <Table.Root>
              {/* The widths are measured from the first rows, so the loading table (skeleton rows) is a table of its own. */}
              <Table
                key={events.isPending ? 'loading' : 'ready'}
                aria-label="Events"
                aria-busy={events.isPending || undefined}
                stickyHeader
                columnWidths={widths.widths}
                onColumnWidthsChange={widths.onChange}
              >
                <Table.Header>
                  <Table.Row>
                    <Table.Head className="label-12-strong" resizable={!events.isPending} columnKey="when" width={176} minWidth={120} maxWidth={320}>
                      When
                    </Table.Head>
                    <Table.Head className="label-12-strong" resizable={!events.isPending} columnKey="kind" width={128} minWidth={96} maxWidth={240}>
                      Kind
                    </Table.Head>
                    {/* The message column takes the rest of the row, so When and Kind are what resize it; its text still wraps. */}
                    <Table.Head className="label-12-strong" truncate>
                      Event
                    </Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body bordered interactive>
                  {events.isPending && <TableSkeletonRows columns={eventColumns} />}
                  {pageRows.map((e, i) => (
                    <EventRow
                      key={e.id}
                      e={e}
                      index={i}
                      selected={i === sel}
                      title={names.get(e.title_id ?? -1)}
                      onSelect={() => setSel(i)}
                      onFilter={(name, value) => filterTo(withValue(query, name, value, qualifiers))}
                    />
                  ))}
                </Table.Body>
              </Table>
            </Table.Root>
          )}
        </div>
        {shown.length > PAGE_SIZE && (
          <PagerStrip>
            <Pager aria-label="Log pages" page={shownPage} pageSize={PAGE_SIZE} total={shown.length} onPageChange={toPage} />
          </PagerStrip>
        )}
      </div>
    </div>
  )
}

/** The kind of an event as a plain label: the Kind filter menu is where the Log is filtered by it. */
function KindLabel({ kind }: { kind: string }) {
  return (
    <Badge variant={kinds[kind]?.tone ?? 'gray'} contrast="low" size="sm">
      {kinds[kind]?.label ?? kind}
    </Badge>
  )
}

/** A Title's name in an event, as the link that adds it to the filter. */
function TitleLink({ title, onFilter }: { title: string; onFilter: (name: 'title', value: string) => void }) {
  return (
    <>
      <Link as="button" aria-label={`Filter by ${termText({ name: 'title', values: [title], excluded: false })}`} onClick={() => onFilter('title', title)}>
        {title}
      </Link>{' '}
    </>
  )
}

function PhoneEvent({ e, index, sel, onSelect, title, onFilter }: { e: LogEvent; index: number; sel: number; onSelect: () => void; title?: string; onFilter: (name: 'title', value: string) => void }) {
  return (
    <Entity as="button" current={index === sel} data-nav={`log-${index}`} onClick={onSelect}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <KindLabel kind={e.kind} />
          <span className="label-12 tabular text-gray-900">{when(e.at)}</span>
        </div>
        <div className="min-w-0 break-words">
          {title && <TitleLink title={title} onFilter={onFilter} />}
          <span className="text-gray-900">{e.message}</span>
        </div>
      </div>
    </Entity>
  )
}

function EventRow({
  e,
  index,
  selected,
  title,
  onSelect,
  onFilter,
}: {
  e: LogEvent
  index: number
  selected: boolean
  title?: string
  onSelect: () => void
  onFilter: (name: 'title', value: string) => void
}) {
  return (
    <Table.Row data-nav={`log-${index}`} current={selected} onClick={onSelect}>
      <Table.Cell className="label-12 tabular">{when(e.at)}</Table.Cell>
      <Table.Cell>
        <KindLabel kind={e.kind} />
      </Table.Cell>
      <Table.Cell wrap className="break-words">
        {title && <TitleLink title={title} onFilter={onFilter} />}
        <span className="text-gray-900">{e.message}</span>
      </Table.Cell>
    </Table.Row>
  )
}

function Blocklist({
  query,
  onQuery,
  widths,
  onBack,
  onView,
}: {
  query: string
  onQuery: (query: string) => void
  widths: ReturnType<typeof useColumnWidths>
  onBack: () => void
  onView: (query: string) => void
}) {
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
  const qualifiers = useMemo(() => logQualifiers(kindLabels, [...new Set((titles ?? []).map((t) => t.title))]), [titles])

  return (
    <div className={phone ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1'}>
      <LogPanel query={query} onQuery={onQuery} onView={onView} qualifiers={qualifiers} filtered={false} widths={widths} blocklist={{ showing: true, onBack }} />
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
                      {b.reason} · {when(b.created_at)}
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
                        {b.reason} · {when(b.created_at)}
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

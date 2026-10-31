// The Log: what Kestrel did, filtered by one field of qualifiers (kind:, slot:, title:,
// routine:) and free text, with routine events hidden until asked for; and the Blocklist view,
// where an entry can be removed.
import { Badge, Button, EmptyState, Entity, Link, Note, Table, Tabs, parseQuery, termText, withValue, type BadgeProps } from '@hyprsh/design'
import { useMemo, useState } from 'react'
import { useBlocklist, useEvents, useUnblock, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../fuzzy'
import { FilterBar } from '../filter/FilterBar'
import { FilterStrip } from '../layout/FilterStrip'
import { useKey, useListNav } from '../keys'
import { SkeletonRow, SkeletonRows } from '../loading'
import { usePhone } from '../responsive'
import { useReport } from '../toasts'
import { logFilter, logQualifiers } from './filter'

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

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Log({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const [view, setView] = useState<'log' | 'blocklist'>('log')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterStrip>
        <Tabs
          variant="secondary"
          aria-label="Log views"
          selected={view}
          onChange={(v) => setView(v as 'log' | 'blocklist')}
          tabs={[
            { value: 'log', title: 'Log' },
            { value: 'blocklist', title: 'Blocklist' },
          ]}
        />
      </FilterStrip>
      {view === 'log' ? <Events query={query} onQuery={onQuery} /> : <Blocklist />}
    </div>
  )
}

/** What a skeleton row sizes its cells by: the Log's three columns. */
const eventColumns = [
  { key: 'when', header: 'When' },
  { key: 'kind', header: 'Kind' },
  { key: 'event', header: 'Event' },
]

/** The Blocklist's two columns. */
const blockColumns = [
  { key: 'release', header: 'Release', mono: true, truncate: true },
  { key: 'actions', header: 'Actions', numeric: true },
]

function useTitleNames() {
  const titles = useTitles().data
  return useMemo(() => ({ list: titles, names: new Map((titles ?? []).map((t) => [t.id, t.title])) }), [titles])
}

function Events({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const phone = usePhone()
  const [sel, setSel] = useState(0)
  const { list: titles, names } = useTitleNames()
  const qualifiers = useMemo(() => logQualifiers(kindLabels, [...new Set((titles ?? []).map((t) => t.title))]), [titles])
  const parsed = useMemo(() => parseQuery(query, qualifiers), [query, qualifiers])
  const byTitle = parsed.terms.some((t) => t.name === 'title')
  // A title: filter names Titles, so it waits for the Library to know which.
  const events = useEvents(logFilter(parsed, titles ?? []), !byTitle || titles !== undefined)

  const eventSkeleton = [0, 1, 2, 3, 4, 5].map((i) => <Table.SkeletonRow key={i} index={i} columns={eventColumns} />)
  const shown = useMemo(() => (events.data ?? []).filter((e) => matchText(parsed.text, [e.message, names.get(e.title_id ?? -1) ?? ''])), [events.data, parsed.text, names])

  useListNav('log', shown.length, sel, setSel)
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('log-filter')?.focus()
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterStrip>
        <FilterBar id="log-filter" label="Filter the Log" placeholder="Filter, e.g. kind:failures slot:4k …  /" value={query} onChange={onQuery} qualifiers={qualifiers} />
      </FilterStrip>
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
              {shown.map((e, i) => (
                <PhoneEvent
                  key={e.id}
                  e={e}
                  index={i}
                  sel={sel}
                  onSelect={() => setSel(i)}
                  title={names.get(e.title_id ?? -1)}
                  onFilter={(name, value) => onQuery(withValue(query, name, value, qualifiers))}
                />
              ))}
            </Entity.List>
          </div>
        ) : (
          <Table.Root>
            <Table aria-label="Events" aria-busy={events.isPending || undefined}>
              <Table.Colgroup>
                <Table.Col style={{ width: 160 }} />
                <Table.Col style={{ width: 128 }} />
                <Table.Col />
              </Table.Colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head className="label-12-strong">When</Table.Head>
                  <Table.Head className="label-12-strong">Kind</Table.Head>
                  <Table.Head className="label-12-strong">Event</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body bordered interactive>
                {events.isPending && eventSkeleton}
                {shown.map((e, i) => (
                  <EventRow
                    key={e.id}
                    e={e}
                    index={i}
                    selected={i === sel}
                    title={names.get(e.title_id ?? -1)}
                    onSelect={() => setSel(i)}
                    onFilter={(name, value) => onQuery(withValue(query, name, value, qualifiers))}
                  />
                ))}
              </Table.Body>
            </Table>
          </Table.Root>
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

function Blocklist() {
  const phone = usePhone()
  const list = useBlocklist()
  const unblock = useUnblock()
  const report = useReport()
  const remove = (id: number) => void report(unblock.mutateAsync(id), { done: 'Release removed from the Blocklist', failed: 'Could not remove the Release from the Blocklist' })
  const { names } = useTitleNames()
  const [sel, setSel] = useState(0)
  const items = list.data ?? []
  useListNav('block', items.length, sel, setSel)
  const skeleton = [0, 1, 2, 3, 4].map((i) => <Table.SkeletonRow key={i} index={i} columns={blockColumns} />)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
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
              {list.isPending && skeleton}
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
  )
}

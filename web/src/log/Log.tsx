// The Log: what Kestrel did, filtered by one field of qualifiers (kind:, slot:, title:,
// routine:) and free text, with routine events hidden until asked for; and the Blocklist view,
// where an entry can be removed.
import { Badge, Button, EmptyState, Note, Table, Tabs, parseQuery, termText, withValue, type BadgeProps } from '@hyprsh/design'
import { useMemo, useState } from 'react'
import { useBlocklist, useEvents, useUnblock, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../fuzzy'
import { FilterBar } from '../filter/FilterBar'
import { useKey, useListNav } from '../keys'
import { usePhone } from '../responsive'
import { logFilter, logQualifiers } from './filter'

type Tone = NonNullable<BadgeProps['variant']>

const kinds: Record<string, { label: string; tone: Tone }> = {
  grab: { label: 'Grabbed', tone: 'blue-subtle' },
  grab_failed: { label: 'Failed', tone: 'red-subtle' },
  grab_canceled: { label: 'Canceled', tone: 'gray-subtle' },
  grab_downloading: { label: 'Downloading', tone: 'gray-subtle' },
  grab_completed: { label: 'Downloaded', tone: 'gray-subtle' },
  import: { label: 'Imported', tone: 'green-subtle' },
  import_episode: { label: 'Episode', tone: 'green-subtle' },
  import_rejected: { label: 'Import rejected', tone: 'red-subtle' },
  import_stalled: { label: 'Import stalled', tone: 'amber-subtle' },
  blocklist: { label: 'Blocklisted', tone: 'red-subtle' },
  request: { label: 'Requested', tone: 'teal-subtle' },
  rename: { label: 'Renamed', tone: 'gray-subtle' },
  move: { label: 'Moved', tone: 'gray-subtle' },
  delete: { label: 'Deleted', tone: 'gray-subtle' },
  title_refreshed: { label: 'Refreshed', tone: 'gray-subtle' },
  search: { label: 'Searched', tone: 'gray-subtle' },
  adoption: { label: 'Adopted', tone: 'teal-subtle' },
  adoption_scanned: { label: 'Scanned', tone: 'gray-subtle' },
  cleanup: { label: 'Cleaned up', tone: 'gray-subtle' },
  health_raised: { label: 'Warning', tone: 'amber-subtle' },
  health_cleared: { label: 'Cleared', tone: 'green-subtle' },
  original_offered: { label: 'Original offered', tone: 'amber-subtle' },
}

const kindLabels = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.label]))

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Log({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const [view, setView] = useState<'log' | 'blocklist'>('log')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-4 py-2">
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
      </div>
      {view === 'log' ? <Events query={query} onQuery={onQuery} /> : <Blocklist />}
    </div>
  )
}

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

  const shown = useMemo(
    () => (events.data ?? []).filter((e) => matchText(parsed.text, [e.message, names.get(e.title_id ?? -1) ?? ''])),
    [events.data, parsed.text, names],
  )

  useListNav('log', shown.length, sel, setSel)
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('log-filter')?.focus()
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-alpha-400 px-4 py-2">
        <FilterBar id="log-filter" label="Filter the Log" placeholder="Filter, e.g. kind:failures slot:4k …  /" value={query} onChange={onQuery} qualifiers={qualifiers} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.isError && <Note variant="error">The Log could not be loaded.</Note>}
        {events.data && shown.length === 0 && <EmptyState className="m-4 w-auto" description="Nothing in the Log matches." />}
        {phone ? (
          // A phone has no room for three columns: each event is a stacked row, its message wrapping under the kind and the time.
          <ul aria-label="Events" className="divide-y divide-gray-alpha-400">
            {shown.map((e, i) => (
              <PhoneEvent key={e.id} e={e} index={i} title={names.get(e.title_id ?? -1)} onFilter={(name, value) => onQuery(withValue(query, name, value, qualifiers))} />
            ))}
          </ul>
        ) : (
          <Table.Root>
            <Table aria-label="Events">
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

/** The kind of an event as the button that filters the Log by it. */
function KindButton({ kind, onFilter }: { kind: string; onFilter: (name: 'kind' | 'title', value: string) => void }) {
  return (
    <button aria-label={`Filter by kind:${kind}`} title={`kind:${kind}`} onClick={() => onFilter('kind', kind)} className="rounded-full hover:opacity-80 max-sm:-my-2 max-sm:py-2">
      <Badge variant={kinds[kind]?.tone ?? 'gray-subtle'} size="sm">
        {kinds[kind]?.label ?? kind}
      </Badge>
    </button>
  )
}

function PhoneEvent({ e, index, title, onFilter }: { e: LogEvent; index: number; title?: string; onFilter: (name: 'kind' | 'title', value: string) => void }) {
  return (
    <li data-nav={`log-${index}`} className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <KindButton kind={e.kind} onFilter={onFilter} />
        <span className="label-12 tabular text-gray-900">{when(e.at)}</span>
      </div>
      <div className="min-w-0 break-words">
        {title && (
          <>
            <button
              aria-label={`Filter by ${termText({ name: 'title', values: [title], excluded: false })}`}
              onClick={() => onFilter('title', title)}
              className="font-medium text-gray-1000 max-sm:py-1"
            >
              {title}
            </button>{' '}
          </>
        )}
        <span className="text-gray-900">{e.message}</span>
      </div>
    </li>
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
  onFilter: (name: 'kind' | 'title', value: string) => void
}) {
  return (
    <Table.Row data-nav={`log-${index}`} current={selected} onClick={onSelect}>
      <Table.Cell className="label-12 tabular">{when(e.at)}</Table.Cell>
      <Table.Cell>
        <KindButton kind={e.kind} onFilter={onFilter} />
      </Table.Cell>
      <Table.Cell wrap className="break-words">
        {title && (
          <>
            <button
              aria-label={`Filter by ${termText({ name: 'title', values: [title], excluded: false })}`}
              onClick={() => onFilter('title', title)}
              className="font-medium text-gray-1000 hover:underline"
            >
              {title}
            </button>{' '}
          </>
        )}
        <span className="text-gray-900">{e.message}</span>
      </Table.Cell>
    </Table.Row>
  )
}

function Blocklist() {
  const phone = usePhone()
  const list = useBlocklist()
  const unblock = useUnblock()
  const { names } = useTitleNames()
  const [sel, setSel] = useState(0)
  const items = list.data ?? []
  useListNav('block', items.length, sel, setSel)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {unblock.isError && <Note variant="error">The entry could not be removed.</Note>}
      {list.data && items.length === 0 && <EmptyState className="m-4 w-auto" description="The Blocklist is empty." />}
      {items.length > 0 && phone && (
        <ul aria-label="Blocklist" className="divide-y divide-gray-alpha-400">
          {items.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="label-12-mono break-all">{b.release_name}</div>
                <div className="label-13 mt-0.5 text-gray-900">
                  {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                  {b.reason} · {when(b.created_at)}
                </div>
              </div>
              <Button variant="secondary" size="small" width="100%" aria-label={`Remove ${b.release_name} from the Blocklist`} disabled={unblock.isPending} onClick={() => unblock.mutate(b.id)}>
                Remove from the Blocklist
              </Button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && !phone && (
        <Table.Root>
          <Table aria-label="Blocklist">
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
              {items.map((b, i) => (
                <Table.Row
                  key={b.id}
                  data-nav={`block-${i}`}
                  current={i === sel}
                  onClick={() => setSel(i)}
                >
                  <Table.Cell truncate>
                    <div className="label-12-mono truncate">{b.release_name}</div>
                    <div className="label-13 truncate text-gray-900">
                      {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                      {b.reason} · {when(b.created_at)}
                    </div>
                  </Table.Cell>
                  <Table.Cell align="right">
                    <Button
                      variant="secondary"
                      size="small"
                      aria-label={`Remove ${b.release_name} from the Blocklist`}
                      disabled={unblock.isPending}
                      onClick={() => unblock.mutate(b.id)}
                    >
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

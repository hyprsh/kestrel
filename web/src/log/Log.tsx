// The Log: what Kestrel did, filtered by one field of qualifiers (kind:, slot:, title:,
// routine:) and free text, with routine events hidden until asked for; and the Blocklist view,
// where an entry can be removed.
import { Badge, Button, EmptyState, Note, Table, Tabs, type BadgeProps } from '@hyprsh/design'
import { useMemo, useState } from 'react'
import { useBlocklist, useEvents, useUnblock, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../fuzzy'
import { parse, termText, withValue } from '../filter/query'
import { QueryField } from '../filter/QueryField'
import { useKey, useListNav } from '../keys'
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
  const [sel, setSel] = useState(0)
  const { list: titles, names } = useTitleNames()
  const qualifiers = useMemo(() => logQualifiers(Object.keys(kinds), (titles ?? []).map((t) => t.title)), [titles])
  const parsed = useMemo(() => parse(query, qualifiers), [query, qualifiers])
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
        <QueryField id="log-filter" label="Filter the Log" placeholder="Filter, e.g. kind:failures slot:4k …  /" value={query} onChange={onQuery} qualifiers={qualifiers} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.isError && <Note variant="error">The Log could not be loaded.</Note>}
        {events.data && shown.length === 0 && <EmptyState className="m-4" description="Nothing in the Log matches." />}
        <Table.Root>
          <Table aria-label="Events">
            <Table.Colgroup>
              <Table.Col style={{ width: 160 }} />
              <Table.Col style={{ width: 128 }} />
              <Table.Col />
            </Table.Colgroup>
            <Table.Header>
              <Table.Row>
                <Table.Head className="label-12 font-medium">When</Table.Head>
                <Table.Head className="label-12 font-medium">Kind</Table.Head>
                <Table.Head className="label-12 font-medium hy-left">Event</Table.Head>
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
      </div>
    </div>
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
    <Table.Row data-nav={`log-${index}`} aria-current={selected ? 'true' : undefined} onClick={onSelect} className={selected ? 'bg-gray-alpha-200' : undefined}>
      <Table.Cell className="label-12 tabular">{when(e.at)}</Table.Cell>
      <Table.Cell>
        <button
          aria-label={`Filter by kind:${e.kind}`}
          title={`kind:${e.kind}`}
          onClick={() => onFilter('kind', e.kind)}
          className="rounded-full hover:opacity-80"
        >
          <Badge variant={kinds[e.kind]?.tone ?? 'gray-subtle'} size="sm">
            {kinds[e.kind]?.label ?? e.kind}
          </Badge>
        </button>
      </Table.Cell>
      {/* A Table cell clips to one line by default; the Log's message wraps. */}
      <Table.Cell className="hy-left max-w-none whitespace-normal break-words">
        {title && (
          <>
            <button
              aria-label={`Filter by ${termText({ name: 'title', values: [title], negated: false })}`}
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
  const list = useBlocklist()
  const unblock = useUnblock()
  const { names } = useTitleNames()
  const [sel, setSel] = useState(0)
  const items = list.data ?? []
  useListNav('block', items.length, sel, setSel)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {unblock.isError && <Note variant="error">The entry could not be removed.</Note>}
      {list.data && items.length === 0 && <EmptyState className="m-4" description="The Blocklist is empty." />}
      {items.length > 0 && (
        <Table.Root>
          <Table aria-label="Blocklist">
            <Table.Colgroup>
              <Table.Col />
              <Table.Col style={{ width: 96 }} />
            </Table.Colgroup>
            <Table.Header>
              <Table.Row>
                <Table.Head className="label-12 font-medium hy-left">Release</Table.Head>
                <Table.Head className="label-12 font-medium">
                  <span className="sr-only">Actions</span>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body bordered interactive>
              {items.map((b, i) => (
                <Table.Row
                  key={b.id}
                  data-nav={`block-${i}`}
                  aria-current={i === sel ? 'true' : undefined}
                  onClick={() => setSel(i)}
                  className={i === sel ? 'bg-gray-alpha-200' : undefined}
                >
                  <Table.Cell className="hy-left max-w-0">
                    <div className="label-12-mono truncate">{b.release_name}</div>
                    <div className="label-13 truncate text-gray-900">
                      {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                      {b.reason} · {when(b.created_at)}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
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

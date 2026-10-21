// The Log: what Kestrel did, filtered by one field of qualifiers (kind:, slot:, title:,
// routine:) and free text, with routine events hidden until asked for; and the Blocklist view,
// where an entry can be removed.
import { useMemo, useState } from 'react'
import { useBlocklist, useEvents, useUnblock, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { matchText } from '../filter/match'
import { parse, termText, withValue } from '../filter/query'
import { QueryField } from '../filter/QueryField'
import { Button, ErrorText } from '../forms'
import { useKey, useListNav } from '../keys'
import { Badge, type Tone } from '../ui'
import { logFilter, logQualifiers } from './filter'

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

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** `query` is the filter field's text, kept by the Shell so it can live in the address bar. */
export function Log({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const [view, setView] = useState<'log' | 'blocklist'>('log')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-4 py-2" role="tablist" aria-label="Log views">
        {(['log', 'blocklist'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`h-7 rounded-md px-3 text-[13px] ${view === v ? 'bg-gray-alpha-200 font-medium' : 'text-gray-900 hover:bg-gray-alpha-100'}`}
          >
            {v === 'log' ? 'Log' : 'Blocklist'}
          </button>
        ))}
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
        {events.isError && <ErrorText>The Log could not be loaded.</ErrorText>}
        {events.data && shown.length === 0 && <div className="p-6 text-center text-gray-900">Nothing in the Log matches.</div>}
        <ul aria-label="Events">
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
        </ul>
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
    <li
      data-nav={`log-${index}`}
      onClick={onSelect}
      className={`flex items-baseline gap-3 border-b border-gray-alpha-200 px-4 py-2 ${selected ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100'}`}
    >
      <span className="w-36 shrink-0 text-[12px] text-gray-900 tabular">{when(e.at)}</span>
      <span className="w-28 shrink-0">
        <button aria-label={`Filter by kind:${e.kind}`} title={`kind:${e.kind}`} onClick={() => onFilter('kind', e.kind)} className="rounded-full hover:opacity-80">
          <Badge tone={kinds[e.kind]?.tone ?? 'gray'}>{kinds[e.kind]?.label ?? e.kind}</Badge>
        </button>
      </span>
      <span className="min-w-0 flex-1 break-words">
        {title && (
          <>
            <button aria-label={`Filter by ${termText({ name: 'title', values: [title], negated: false })}`} onClick={() => onFilter('title', title)} className="font-medium hover:underline">
              {title}
            </button>{' '}
          </>
        )}
        <span className="text-gray-900">{e.message}</span>
      </span>
    </li>
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
      {unblock.isError && <ErrorText>The entry could not be removed.</ErrorText>}
      {list.data && items.length === 0 && <div className="p-6 text-center text-gray-900">The Blocklist is empty.</div>}
      <ul aria-label="Blocklist">
        {items.map((b, i) => (
          <li
            key={b.id}
            data-nav={`block-${i}`}
            onClick={() => setSel(i)}
            className={`flex items-center gap-3 border-b border-gray-alpha-200 px-4 py-2 ${i === sel ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100'}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px]">{b.release_name}</div>
              <div className="text-gray-900">
                {b.title_id && names.get(b.title_id) ? `${names.get(b.title_id)} · ` : ''}
                {b.reason} · {when(b.created_at)}
              </div>
            </div>
            <Button variant="secondary" aria-label={`Remove ${b.release_name} from the Blocklist`} disabled={unblock.isPending} onClick={() => unblock.mutate(b.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

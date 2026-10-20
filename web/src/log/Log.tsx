// The Log: what Kestrel did, filterable by kind, Title and Slot, with routine events hidden
// until asked for; and the Blocklist view, where an entry can be removed.
import { useMemo, useState } from 'react'
import { useBlocklist, useEvents, useUnblock, type LogEvent } from '../api/log'
import { useTitles } from '../api/queries'
import { Button, ErrorText, Select, TextInput } from '../forms'
import { useKey, useListNav } from '../keys'
import { slotKeys, slotLabel } from '../library/bits'
import { Badge, type Tone } from '../ui'

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
  title_refreshed: { label: 'Refreshed', tone: 'gray' },
  adoption: { label: 'Adopted', tone: 'teal' },
  adoption_scanned: { label: 'Scanned', tone: 'gray' },
  cleanup: { label: 'Cleaned up', tone: 'gray' },
  health_raised: { label: 'Warning', tone: 'amber' },
  health_cleared: { label: 'Cleared', tone: 'green' },
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function Log() {
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
      {view === 'log' ? <Events /> : <Blocklist />}
    </div>
  )
}

function useTitleNames() {
  const titles = useTitles().data
  return useMemo(() => ({ list: titles ?? [], names: new Map((titles ?? []).map((t) => [t.id, t.title])) }), [titles])
}

function Events() {
  const [kind, setKind] = useState('')
  const [slot, setSlot] = useState('')
  const [titleId, setTitleId] = useState<number | null>(null)
  const [routine, setRoutine] = useState(false)
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const events = useEvents({ kind, slot, titleId, routine })
  const { list: titles, names } = useTitleNames()

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (events.data ?? []).filter((e) => !q || e.message.toLowerCase().includes(q) || (names.get(e.title_id ?? -1) ?? '').toLowerCase().includes(q))
  }, [events.data, text, names])

  useListNav('log', shown.length, sel, setSel)
  useKey('/', (e) => {
    e.preventDefault()
    document.getElementById('log-filter')?.focus()
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-alpha-400 px-4 py-2">
        <TextInput
          id="log-filter"
          aria-label="Filter the Log"
          placeholder="Filter…  /"
          className="w-56"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && e.currentTarget.blur()}
        />
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-40">
          <option value="">All kinds</option>
          {Object.entries(kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Title" value={titleId ?? ''} onChange={(e) => setTitleId(e.target.value ? Number(e.target.value) : null)} className="w-48">
          <option value="">All Titles</option>
          {titles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
        <Select aria-label="Slot" value={slot} onChange={(e) => setSlot(e.target.value)} className="w-28">
          <option value="">All Slots</option>
          {slotKeys.map((k) => (
            <option key={k} value={k}>
              {slotLabel[k]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-gray-900">
          <input type="checkbox" checked={routine} onChange={(e) => setRoutine(e.target.checked)} />
          Show routine
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.isError && <ErrorText>The Log could not be loaded.</ErrorText>}
        {events.data && shown.length === 0 && <div className="p-6 text-center text-gray-900">Nothing in the Log matches.</div>}
        <ul aria-label="Events">
          {shown.map((e, i) => (
            <EventRow key={e.id} e={e} index={i} selected={i === sel} title={names.get(e.title_id ?? -1)} onSelect={() => setSel(i)} />
          ))}
        </ul>
      </div>
    </div>
  )
}

function EventRow({ e, index, selected, title, onSelect }: { e: LogEvent; index: number; selected: boolean; title?: string; onSelect: () => void }) {
  return (
    <li
      data-nav={`log-${index}`}
      onClick={onSelect}
      className={`flex items-baseline gap-3 border-b border-gray-alpha-200 px-4 py-2 ${selected ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100'}`}
    >
      <span className="w-36 shrink-0 text-[12px] text-gray-900 tabular">{when(e.at)}</span>
      <span className="w-28 shrink-0">
        <Badge tone={kinds[e.kind]?.tone ?? 'gray'}>{kinds[e.kind]?.label ?? e.kind}</Badge>
      </span>
      <span className="min-w-0 flex-1 break-words">
        {title && <span className="font-medium">{title} </span>}
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

// PROTOTYPE, throwaway. Variant B · Posters: Activity as one feed. Queue pinned on top, then a history timeline; the Blocklist is a filter view.
import { useState, type ReactNode } from 'react'
import { Ban, CircleArrowUp, CircleX, Download, FolderInput, FolderSearch, Inbox, PenLine, Plus, Pause, X } from 'lucide-react'
import { go } from '../../nav'
import { blocklist as mockBlocklist, history, queue as mockQueue, settings, titleById, TODAY, type HistoryEvent, type QueueItem } from '../../mock'
import { Badge, Dot, Poster, cx, fmtNum, type Tone } from '../../ui'
import { Button, Chip, PageHeader, ProgressBar, SectionTitle, SlotPill, fmtDate, useStore } from './common'

type EventType = HistoryEvent['type']
const eventStyle: Record<EventType, { icon: ReactNode; cls: string }> = {
  Grabbed: { icon: <Download size={14} />, cls: 'bg-blue-200 text-blue-900' },
  Imported: { icon: <FolderInput size={14} />, cls: 'bg-green-200 text-green-900' },
  Upgraded: { icon: <CircleArrowUp size={14} />, cls: 'bg-teal-100 text-teal-900' },
  Failed: { icon: <CircleX size={14} />, cls: 'bg-red-200 text-red-900' },
  Blocklisted: { icon: <Ban size={14} />, cls: 'bg-red-200 text-red-900' },
  Renamed: { icon: <PenLine size={14} />, cls: 'bg-gray-200 text-gray-1000' },
  Requested: { icon: <Inbox size={14} />, cls: 'bg-purple-100 text-purple-900' },
  'Version added': { icon: <Plus size={14} />, cls: 'bg-blue-200 text-blue-900' },
  Adopted: { icon: <FolderSearch size={14} />, cls: 'bg-teal-100 text-teal-900' },
}
const types = Object.keys(eventStyle) as EventType[]

const phaseTone: Record<QueueItem['phase'], Tone> = { downloading: 'blue', queued: 'gray', paused: 'amber', importing: 'purple' }

export function Activity() {
  const { toast } = useStore()
  const [filter, setFilter] = useState<EventType | 'all' | 'blocklist'>('all')
  const [queue, setQueue] = useState(mockQueue)
  const [blocklist, setBlocklist] = useState(mockBlocklist)
  const [paused, setPaused] = useState(false)

  const events = filter === 'all' ? history : history.filter((h) => h.type === filter)
  const byDay = events.reduce<Record<string, HistoryEvent[]>>((acc, h) => ((acc[h.at.slice(0, 10)] ??= []).push(h), acc), {})
  const dayLabel = (d: string) => (d === TODAY ? 'Today' : d === '2026-10-16' ? 'Yesterday' : fmtDate(d))

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader
        title="Activity"
        sub="What Kestrel is downloading now, and everything it did before."
        right={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] text-gray-900"><Dot tone={paused ? 'amber' : 'green'} /> SABnzbd · {paused ? 'Paused' : settings.sabnzbd.status}</span>
            <Button size="sm" prefix={<Pause size={13} />} onClick={() => (setPaused((p) => !p), toast(paused ? 'Queue resumed' : 'Queue paused'))}>{paused ? 'Resume' : 'Pause queue'}</Button>
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={history.length}>All</Chip>
        {types.map((t) => {
          const n = history.filter((h) => h.type === t).length
          return n > 0 && <Chip key={t} active={filter === t} onClick={() => setFilter(t)} count={n}>{t}</Chip>
        })}
        <span className="mx-1 h-7 w-px bg-gray-alpha-400" />
        <Chip active={filter === 'blocklist'} onClick={() => setFilter('blocklist')} count={blocklist.length}>
          <Ban size={13} /> Blocklist
        </Chip>
      </div>

      {filter === 'blocklist' ? (
        <section>
          <SectionTitle sub="Releases that failed. Kestrel never grabs them again unless you remove them here.">Blocklist</SectionTitle>
          {blocklist.length === 0 && <p className="rounded-lg border border-dashed border-gray-alpha-400 py-12 text-center text-sm text-gray-900">The Blocklist is empty.</p>}
          <div className="space-y-2">
            {blocklist.map((b) => {
              const t = titleById(b.titleId)
              return (
                <div key={b.id} className="flex items-start gap-4 rounded-lg border border-gray-alpha-400 p-4">
                  <Poster title={t.title} hue={t.hue} small className="w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <button onClick={() => go('title', { id: t.id })} className="font-medium hover:underline">{t.title}</button>
                      <SlotPill slot={b.slot} tone="gray" size="sm" />
                    </div>
                    <div className="mt-1 font-mono text-[12px] break-all">{b.release}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-gray-900">
                      <span className="text-red-900">{b.reason}</span>
                      <span>{b.indexer}</span>
                      <span className="tabular">{fmtDate(b.at)}</span>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => (setBlocklist((l) => l.filter((x) => x.id !== b.id)), toast('Removed from the Blocklist; it can be grabbed again'))}>Remove</Button>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <>
          <section className="mb-10">
            <SectionTitle sub={paused ? 'Paused in SABnzbd' : `${queue.length} in SABnzbd`}>Queue</SectionTitle>
            {queue.length === 0 && <p className="rounded-lg border border-dashed border-gray-alpha-400 py-10 text-center text-sm text-gray-900">Nothing downloading.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {queue.map((q) => <QueueCard key={q.id} q={q} paused={paused} onRemove={() => (setQueue((l) => l.filter((x) => x.id !== q.id)), toast(`Removed ${q.label} from the queue`))} />)}
            </div>
          </section>

          <section>
            <SectionTitle>History</SectionTitle>
            {Object.entries(byDay).map(([day, items]) => (
              <div key={day} className="mb-6">
                <div className="mb-3 text-[12px] font-medium tracking-wide text-gray-900 uppercase">{dayLabel(day)}</div>
                <ol className="relative ml-4 border-l border-gray-alpha-400">
                  {items.map((h) => <EventRow key={h.id} h={h} />)}
                </ol>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}

function QueueCard({ q, paused, onRemove }: { q: QueueItem; paused: boolean; onRemove: () => void }) {
  const t = titleById(q.titleId)
  const phase = paused && q.phase === 'downloading' ? 'paused' : q.phase
  return (
    <div className="rounded-lg border border-gray-alpha-400 bg-background-100 p-4">
      <div className="flex items-start gap-3">
        <Poster title={t.title} hue={t.hue} small className="w-9" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={() => go('title', { id: t.id })} className="truncate text-sm font-medium hover:underline">{q.label}</button>
            <SlotPill slot={q.slot} tone={phaseTone[phase]} size="sm" />
            {q.upgrade && <Badge tone="teal">Upgrade</Badge>}
          </div>
          <div title={q.release} className="mt-0.5 truncate font-mono text-[11px] text-gray-900">{q.release}</div>
        </div>
        <button onClick={onRemove} title="Remove from queue" className="inline-flex size-7 items-center justify-center rounded-md text-gray-900 hover:bg-gray-alpha-200 hover:text-gray-1000">
          <X size={14} />
        </button>
      </div>
      <ProgressBar className="mt-3" value={q.progress} tone={phase === 'importing' ? 'purple' : 'blue'} />
      <div className="tabular mt-2 flex items-center gap-3 text-[12px] text-gray-900">
        <Badge tone={phaseTone[phase]} className="capitalize">{phase}</Badge>
        <span>{q.progress}%</span>
        <span>{q.left} left of {q.size}</span>
        {q.eta !== '—' && <span>· {q.eta}</span>}
        <span className="ml-auto font-mono">{fmtNum(q.score)}</span>
      </div>
    </div>
  )
}

function EventRow({ h }: { h: HistoryEvent }) {
  const s = eventStyle[h.type]
  return (
    <li className="relative pb-5 pl-7 last:pb-0">
      <span className={cx('absolute top-0 -left-[13px] flex size-[26px] items-center justify-center rounded-full ring-4 ring-background-100', s.cls)}>{s.icon}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{h.type}</span>
        <button onClick={() => go('title', { id: h.titleId })} className="text-sm text-gray-1000 hover:underline">{h.label}</button>
        {h.slot && <SlotPill slot={h.slot} tone="gray" size="sm" />}
        <span className="tabular ml-auto font-mono text-[12px] text-gray-900">{h.at.slice(11)}</span>
      </div>
      {h.release && <div className="mt-1 font-mono text-[12px] break-all text-gray-900">{h.release}</div>}
      <div className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-gray-900">
        <span>{h.detail}</span>
        {h.score !== undefined && <span className="tabular font-mono">{fmtNum(h.score)}</span>}
        {h.indexer && <span>{h.indexer}</span>}
      </div>
    </li>
  )
}

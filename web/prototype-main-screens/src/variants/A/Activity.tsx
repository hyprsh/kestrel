// PROTOTYPE, throwaway. Variant A Activity: Geist tabs Queue / History / Blocklist.
import { Pause, Play, Search, Trash2, X } from 'lucide-react'
import { history, type HistoryEvent } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Select, cx, fmtNum } from '../../ui'
import { Button, Empty, Input, Page, PageHeader, Progress, Table, Tabs, td, th } from './shell'
import { eventTone, useStore } from './store'

export function ActivityScreen() {
  const tab = useParam('tab', 'queue')
  const { queue, blocklist } = useStore()
  return (
    <>
      <PageHeader title="Activity" sub="What Kestrel grabbed, imported and refused.">
        <Tabs
          value={tab}
          tabs={[
            { key: 'queue', label: 'Queue', count: queue.length },
            { key: 'history', label: 'History' },
            { key: 'blocklist', label: 'Blocklist', count: blocklist.length },
          ]}
        />
      </PageHeader>
      <Page>
        {tab === 'queue' && <QueueTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'blocklist' && <BlocklistTab />}
      </Page>
    </>
  )
}

function SlotTag({ slot }: { slot?: string }) {
  if (!slot) return <span className="text-gray-700">—</span>
  return <span className="rounded-md border border-gray-alpha-400 px-1.5 font-mono text-[11px] font-medium leading-5">{slot}</span>
}

const phaseTone = { downloading: 'blue', queued: 'gray', paused: 'amber', importing: 'teal' } as const

function QueueTab() {
  const { queue, setQueue, notify } = useStore()
  if (!queue.length) return <Empty>The queue is empty.</Empty>
  return (
    <>
      <div className="mb-3 flex items-center gap-3 text-[13px] text-gray-900">
        <span className="tabular">
          {queue.length} in SABnzbd · category <span className="font-mono">kestrel</span> · 1.8 TB free on /data
        </span>
        <Button size="sm" className="ml-auto" prefix={<Pause className="size-3.5" />} onClick={() => notify('SABnzbd queue paused')}>
          Pause all
        </Button>
      </div>
      <Table
        head={
          <>
            <th className={th}>Title</th>
            <th className={th}>Version</th>
            <th className={th}>Release</th>
            <th className={cx(th, 'w-56')}>Progress</th>
            <th className={cx(th, 'text-right')}>ETA</th>
            <th className={cx(th, 'text-right')}>Score</th>
            <th className={th}>Indexer</th>
            <th className={cx(th, 'w-20')} />
          </>
        }
      >
        {queue.map((q) => (
          <tr key={q.id} className="hover:bg-gray-alpha-100">
            <td className={td}>
              <button onClick={() => go('title', { id: q.titleId })} className="font-medium hover:underline">
                {q.label}
              </button>
            </td>
            <td className={td}>
              <div className="flex items-center gap-1.5">
                <SlotTag slot={q.slot} />
                {q.upgrade && <Badge tone="teal">Upgrade</Badge>}
              </div>
            </td>
            <td className={cx(td, 'max-w-[380px]')}>
              <div className="truncate font-mono text-[12px]" title={q.release}>
                {q.release}
              </div>
            </td>
            <td className={td}>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <Badge tone={phaseTone[q.phase]}>{q.phase[0].toUpperCase() + q.phase.slice(1)}</Badge>
                <span className="tabular text-gray-900">
                  {q.progress}% · {q.left} of {q.size}
                </span>
              </div>
              <Progress value={q.progress} tone={q.phase === 'importing' ? 'green' : q.phase === 'queued' ? 'gray' : 'blue'} />
            </td>
            <td className={cx(td, 'tabular whitespace-nowrap text-right')}>{q.eta}</td>
            <td className={cx(td, 'tabular text-right font-mono text-[12px]')}>{fmtNum(q.score)}</td>
            <td className={cx(td, 'text-gray-900')}>{q.indexer}</td>
            <td className={cx(td, 'text-right')}>
              <div className="flex justify-end gap-0.5">
                <button
                  title={q.phase === 'paused' ? 'Resume' : 'Pause'}
                  onClick={() => setQueue((qs) => qs.map((x) => (x.id === q.id ? { ...x, phase: x.phase === 'paused' ? 'downloading' : 'paused' } : x)))}
                  className="rounded-md p-1.5 text-gray-900 hover:bg-gray-alpha-200 hover:text-gray-1000"
                >
                  {q.phase === 'paused' ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </button>
                <button
                  title="Remove from queue and blocklist the Release"
                  onClick={() => {
                    setQueue((qs) => qs.filter((x) => x.id !== q.id))
                    notify('Removed from queue')
                  }}
                  className="rounded-md p-1.5 text-gray-900 hover:bg-gray-alpha-200 hover:text-red-900"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </>
  )
}

const TYPES: ('All events' | HistoryEvent['type'])[] = ['All events', 'Grabbed', 'Imported', 'Upgraded', 'Failed', 'Blocklisted', 'Renamed', 'Requested', 'Version added', 'Adopted']

function HistoryTab() {
  const type = useParam('type', 'All events')
  const slot = useParam('slot', 'All Slots')
  const q = useParam('q')
  const rows = history
    .filter((h) => type === 'All events' || h.type === type)
    .filter((h) => slot === 'All Slots' || h.slot === slot)
    .filter((h) => !q || `${h.label} ${h.release ?? ''} ${h.detail}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Select value={type} options={TYPES} onChange={(v) => navigate({ type: v === 'All events' ? null : v }, true)} />
        <Select value={slot} options={['All Slots', 'SD', 'HD', 'UHD']} onChange={(v) => navigate({ slot: v === 'All Slots' ? null : v }, true)} />
        <Input className="w-72" prefix={<Search className="size-4" />} placeholder="Filter by Title or Release…" value={q} onChange={(e) => navigate({ q: e.target.value || null }, true)} />
        <span className="tabular ml-auto text-[12px] text-gray-900">
          {rows.length} of {history.length} events
        </span>
      </div>
      <Table
        head={
          <>
            <th className={cx(th, 'w-36')}>When</th>
            <th className={cx(th, 'w-28')}>Event</th>
            <th className={th}>Title</th>
            <th className={th}>Slot</th>
            <th className={th}>Release / detail</th>
            <th className={cx(th, 'text-right')}>Score</th>
            <th className={th}>Indexer</th>
          </>
        }
      >
        {rows.map((h) => (
          <tr key={h.id} className="hover:bg-gray-alpha-100">
            <td className={cx(td, 'tabular whitespace-nowrap text-gray-900')}>{h.at}</td>
            <td className={td}>
              <Badge tone={eventTone[h.type]}>{h.type}</Badge>
            </td>
            <td className={cx(td, 'whitespace-nowrap')}>
              <button onClick={() => go('title', { id: h.titleId, tab: 'history' })} className="font-medium hover:underline">
                {h.label}
              </button>
            </td>
            <td className={td}>
              <SlotTag slot={h.slot} />
            </td>
            <td className={cx(td, 'max-w-[520px]')}>
              {h.release && (
                <div className="truncate font-mono text-[12px]" title={h.release}>
                  {h.release}
                </div>
              )}
              <div className="text-[12px] text-gray-900">{h.detail}</div>
            </td>
            <td className={cx(td, 'tabular text-right font-mono text-[12px]')}>{h.score ? fmtNum(h.score) : '—'}</td>
            <td className={cx(td, 'text-gray-900')}>{h.indexer ?? '—'}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="px-3 py-10 text-center text-gray-900">
              No events match.
            </td>
          </tr>
        )}
      </Table>
    </>
  )
}

function BlocklistTab() {
  const { blocklist, setBlocklist, titleById, notify } = useStore()
  if (!blocklist.length) return <Empty>The Blocklist is empty. Failed Releases land here and are never grabbed again.</Empty>
  return (
    <>
      <p className="mb-3 text-[13px] text-gray-900">Releases that failed are never grabbed again. Remove an entry to allow it in searches and manual Grabs.</p>
      <Table
        head={
          <>
            <th className={cx(th, 'w-36')}>Added</th>
            <th className={th}>Title</th>
            <th className={th}>Slot</th>
            <th className={th}>Release</th>
            <th className={th}>Reason</th>
            <th className={th}>Indexer</th>
            <th className={cx(th, 'w-24')} />
          </>
        }
      >
        {blocklist.map((b) => (
          <tr key={b.id} className="hover:bg-gray-alpha-100">
            <td className={cx(td, 'tabular whitespace-nowrap text-gray-900')}>{b.at}</td>
            <td className={cx(td, 'whitespace-nowrap')}>
              <button onClick={() => go('title', { id: b.titleId })} className="font-medium hover:underline">
                {titleById(b.titleId)?.title}
              </button>
            </td>
            <td className={td}>
              <SlotTag slot={b.slot} />
            </td>
            <td className={cx(td, 'max-w-[420px]')}>
              <div className="truncate font-mono text-[12px]" title={b.release}>
                {b.release}
              </div>
            </td>
            <td className={cx(td, 'text-red-900')}>{b.reason}</td>
            <td className={cx(td, 'text-gray-900')}>{b.indexer}</td>
            <td className={cx(td, 'text-right')}>
              <Button
                size="sm"
                variant="tertiary"
                prefix={<Trash2 className="size-3.5" />}
                onClick={() => {
                  setBlocklist((bl) => bl.filter((x) => x.id !== b.id))
                  notify('Removed from the Blocklist')
                }}
              >
                Remove
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </>
  )
}

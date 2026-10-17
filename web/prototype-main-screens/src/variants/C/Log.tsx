// PROTOTYPE, throwaway. Variant C Log: history only (the live queue is on the Overview), with a Blocklist view.
import { useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { go, navigate, useParam } from '../../nav'
import { type HistoryEvent } from '../../mock'
import { Badge, Button, cx, fmtNum } from '../../ui'
import { useStore } from './store'
import { LinkButton, Page, Segmented, eventTone, fmtWhen, useKey, useListNav } from './bits'

const types: HistoryEvent['type'][] = ['Grabbed', 'Imported', 'Upgraded', 'Failed', 'Blocklisted', 'Requested', 'Version added', 'Renamed', 'Adopted']

export function Log() {
  const s = useStore()
  const view = useParam('view', 'history') as 'history' | 'blocklist'
  const [q, setQ] = useState('')
  const [type, setType] = useState<HistoryEvent['type'] | 'all'>('all')
  const [sel, setSel] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)

  const ql = q.toLowerCase()
  const events = s.history.filter((h) => (type === 'all' || h.type === type) && (!ql || `${h.label} ${h.release ?? ''} ${h.detail}`.toLowerCase().includes(ql)))
  const blocked = s.blocklist.filter((b) => !ql || `${b.release} ${b.reason}`.toLowerCase().includes(ql))
  const rows = view === 'history' ? events.length : blocked.length
  useListNav('log', rows, sel, setSel, (i) => go('library', { id: view === 'history' ? events[i].titleId : blocked[i].titleId }))
  useKey('/', (e) => (e.preventDefault(), document.getElementById('log-filter')?.focus()))
  const titleName = (id: string) => s.titles.find((t) => t.id === id)?.title ?? id

  return (
    <Page wide>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Log</h1>
          <p className="text-gray-900">
            What Kestrel did, newest first. The live queue is on the{' '}
            <LinkButton onClick={() => go('overview')} className="text-[13px]">
              Overview <ArrowUpRight className="size-3" />
            </LinkButton>
          </p>
        </div>
        <Segmented
          value={view}
          onChange={(v) => (setSel(0), navigate({ view: v === 'history' ? null : v }))}
          options={[
            { value: 'history', label: `History · ${s.history.length}` },
            { value: 'blocklist', label: `Blocklist · ${s.blocklist.length}` },
          ]}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-64 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-100 px-2 focus-within:ring-2 focus-within:ring-gray-alpha-400">
          <Search className="size-3.5 text-gray-900" />
          <input id="log-filter" value={q} onChange={(e) => (setQ(e.target.value), setSel(0))} onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} placeholder="Filter by Title, release, detail" className="w-full bg-transparent outline-none placeholder:text-gray-700" />
        </label>
        {view === 'history' &&
          (['all', ...types] as const).map((t) => (
            <button
              key={t}
              onClick={() => (setType(t), setSel(0))}
              className={cx('h-7 rounded-full border px-2.5 text-[12px] transition-colors', type === t ? 'border-gray-1000 bg-gray-1000 text-background-100' : 'border-gray-alpha-400 text-gray-900 hover:text-gray-1000')}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-alpha-400">
        <table className="w-full table-fixed border-collapse text-left text-[12px]">
          {view === 'history' ? (
            <>
              <thead>
                <tr className="border-b border-gray-alpha-400 bg-background-200 text-[11px] text-gray-900 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                  <th className="w-40">When</th>
                  <th className="w-28">Type</th>
                  <th className="w-44">Title</th>
                  <th className="w-12">Slot</th>
                  <th>Release</th>
                  <th className="w-20 text-right">Score</th>
                  <th className="w-[30%]">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((h, i) => (
                  <tr key={h.id} data-nav={`log-${i}`} onClick={() => setSel(i)} className={cx('border-b border-gray-alpha-400 last:border-b-0 [&>td]:px-3 [&>td]:py-1.5', i === sel ? '[&>td]:bg-gray-alpha-200' : 'hover:[&>td]:bg-gray-alpha-100')}>
                    <td className="font-mono whitespace-nowrap text-gray-900 tabular">{fmtWhen(h.at)}</td>
                    <td>
                      <Badge tone={eventTone[h.type]}>{h.type}</Badge>
                    </td>
                    <td className="truncate">
                      <button className="hover:underline" onClick={() => go('library', { id: h.titleId })}>
                        {h.label}
                      </button>
                    </td>
                    <td className="font-mono">{h.slot ?? '—'}</td>
                    <td className="truncate font-mono text-gray-900" title={h.release}>
                      {h.release ?? '—'}
                    </td>
                    <td className="text-right font-mono tabular">{h.score !== undefined ? fmtNum(h.score) : '—'}</td>
                    <td className="truncate text-gray-900" title={h.detail}>
                      {h.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr className="border-b border-gray-alpha-400 bg-background-200 text-[11px] text-gray-900 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                  <th className="w-40">Blocklisted</th>
                  <th className="w-36">Title</th>
                  <th className="w-12">Slot</th>
                  <th>Release</th>
                  <th className="w-24">Indexer</th>
                  <th className="w-56">Reason</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody>
                {blocked.map((b, i) => (
                  <tr key={b.id} data-nav={`log-${i}`} onClick={() => setSel(i)} className={cx('border-b border-gray-alpha-400 last:border-b-0 [&>td]:px-3 [&>td]:py-1.5', i === sel ? '[&>td]:bg-gray-alpha-200' : 'hover:[&>td]:bg-gray-alpha-100')}>
                    <td className="font-mono whitespace-nowrap text-gray-900 tabular">{fmtWhen(b.at)}</td>
                    <td className="truncate">
                      <button className="hover:underline" onClick={() => go('library', { id: b.titleId })}>
                        {titleName(b.titleId)}
                      </button>
                    </td>
                    <td className="font-mono">{b.slot}</td>
                    <td className="truncate font-mono text-gray-900" title={b.release}>
                      {b.release}
                    </td>
                    <td>{b.indexer}</td>
                    <td className="truncate text-red-900" title={b.reason}>
                      {b.reason}
                    </td>
                    <td className="text-right">
                      {confirm === b.id ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="tertiary" className="h-6 px-1.5 text-[12px]" onClick={() => setConfirm(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="error"
                            className="h-6 px-1.5 text-[12px]"
                            onClick={() => {
                              s.setBlocklist(s.blocklist.filter((x) => x.id !== b.id))
                              setConfirm(null)
                              s.toast('Removed from the Blocklist; it can be grabbed again')
                            }}
                          >
                            Remove
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="tertiary" className="h-6 px-1.5 text-[12px]" onClick={() => setConfirm(b.id)}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
        {rows === 0 && <div className="px-3 py-6 text-center text-gray-900">Nothing matches.</div>}
      </div>
    </Page>
  )
}

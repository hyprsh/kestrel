// PROTOTYPE, throwaway. Variant C manual search: dense keyboard-selectable Release table in the right pane, Grab footer.
import { useState } from 'react'
import { ArrowLeft, Download } from 'lucide-react'
import { go } from '../../nav'
import { manualSearch, TODAY, type SearchResult, type Slot, type Title } from '../../mock'
import { Badge, Button, Kbd, cx, fmtNum } from '../../ui'
import { useStore } from './store'
import { Checkbox, useKey, useListNav } from './bits'

/** The mock results are Oppenheimer's; rename them for other Titles so the table reads plausibly. */
function resultsFor(t: Title, slot: Slot): SearchResult[] {
  const stem = `${t.title.replace(/[^A-Za-z0-9]+/g, '.').replace(/\.$/, '')}.${t.year}`
  const rows = t.id === 'oppenheimer' ? manualSearch : manualSearch.map((r) => ({ ...r, release: r.release.replace('Oppenheimer.2023', stem) }))
  // Without a file there is no "current" row and nothing to beat.
  if (t.versions.find((v) => v.slot === slot)?.state === 'available') return rows
  return rows.map((r) => ({ ...r, current: false, rejections: r.rejections.filter((x) => !x.startsWith('Not an Upgrade')) }))
}

function grabState(r: SearchResult, slot: Slot): { label: string; disabled: boolean; reason?: string } {
  if (r.current) return { label: 'Grab', disabled: true, reason: 'This is the current file' }
  if (r.blocklisted) return { label: 'Grab', disabled: true, reason: 'Blocklisted Releases are never grabbed again' }
  if (r.otherSlot) return { label: 'Grab', disabled: true, reason: `Fits the ${r.otherSlot} Slot; it can't fill the ${slot} Version` }
  if (r.rejections.length) return { label: 'Grab anyway', disabled: false, reason: r.rejections.join(' · ') }
  return { label: 'Grab', disabled: false }
}

export function ManualSearch({ t, slot }: { t: Title; slot: Slot }) {
  const s = useStore()
  const [hideRejected, setHideRejected] = useState(false)
  const all = resultsFor(t, slot)
  const rows = hideRejected ? all.filter((r) => !r.rejections.length || r.current) : all
  const [sel, setSel] = useState(0)
  const v = t.versions.find((x) => x.slot === slot)
  const profile = s.profiles.find((p) => p.id === v?.profileId)
  const r = rows[Math.min(sel, rows.length - 1)]
  const g = r && grabState(r, slot)

  const grab = () => {
    if (!r || g.disabled) return
    const upgrade = v?.state === 'available'
    s.setQueue([
      { id: `q${Date.now()}`, titleId: t.id, slot, label: t.title, release: r.release, indexer: r.indexer, phase: 'queued', progress: 0, size: r.size, left: r.size, eta: '—', score: r.score, upgrade },
      ...s.queue,
    ])
    if (!upgrade) s.updateVersion(t.id, slot, (x) => ({ ...x, state: 'downloading', progress: 0, lastSearched: TODAY }))
    s.log({ type: 'Grabbed', titleId: t.id, slot, label: t.title, release: r.release, score: r.score, indexer: r.indexer, detail: g.label === 'Grab anyway' ? `Manual Grab despite: ${g.reason}` : 'Manual search' })
    s.toast(`Grabbed ${r.release} for ${slot} → SABnzbd`)
    go('library', { id: t.id })
  }

  useListNav('ms', rows.length, sel, setSel, grab)
  useKey('Escape', () => go('library', { id: t.id }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-alpha-400 px-4 py-2.5">
        <Button size="sm" variant="tertiary" className="h-7 px-2" prefix={<ArrowLeft className="size-3.5" />} onClick={() => go('library', { id: t.id })}>
          {t.title}
        </Button>
        <span className="text-gray-700">/</span>
        <span className="font-semibold tracking-tight">Manual search</span>
        <span className="rounded border border-gray-alpha-400 px-1 font-mono text-[11px]">{slot}</span>
        <span className="text-gray-900">Profile {profile?.name ?? '—'} · {rows.length} Releases from 3 indexers · sorted by score</span>
        <span className="ml-auto">
          <Checkbox checked={hideRejected} onChange={setHideRejected} label={<span className="text-[12px] text-gray-900">Hide rejected</span>} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-background-100">
            <tr className="border-b border-gray-alpha-400 text-[11px] text-gray-900 [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
              <th className="w-16 pl-4 text-right">Score</th>
              <th>Release</th>
              <th className="w-28">Quality</th>
              <th className="w-28">Languages</th>
              <th className="w-52">Custom formats</th>
              <th className="w-20 text-right">Size</th>
              <th className="w-14 text-right">Age</th>
              <th className="w-28 pr-4">Indexer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => {
              const rejected = x.rejections.length > 0 && !x.current
              return (
                <tr
                  key={x.release}
                  data-nav={`ms-${i}`}
                  onClick={() => setSel(i)}
                  onDoubleClick={grab}
                  className={cx('cursor-pointer border-b border-gray-alpha-400 align-top [&>td]:px-2 [&>td]:py-1.5', i === sel ? '[&>td]:bg-gray-alpha-200' : 'hover:[&>td]:bg-gray-alpha-100')}
                >
                  <td className={cx('pl-4 text-right font-mono tabular', rejected && 'opacity-50', x.current && 'shadow-[inset_2px_0_0_var(--ds-green-700)]')}>{fmtNum(x.score)}</td>
                  <td>
                    <div className={cx('flex items-center gap-1.5', rejected && 'opacity-50')}>
                      <span className="truncate font-mono text-[12px]" title={x.release}>
                        {x.release}
                      </span>
                      {x.current && <Badge tone="green">Current file</Badge>}
                      {x.blocklisted && <Badge tone="red">Blocklisted</Badge>}
                      {x.otherSlot && <Badge tone="gray">{x.otherSlot} Slot</Badge>}
                    </div>
                    {x.rejections.length > 0 && !x.current && <div className={cx('mt-0.5 text-[11px]', x.blocklisted || x.otherSlot ? 'text-red-900' : 'text-amber-900')}>{x.rejections.join(' · ')}</div>}
                  </td>
                  <td className={cx('whitespace-nowrap', rejected && 'opacity-50')}>{x.quality}</td>
                  <td className={cx('whitespace-nowrap', rejected && 'opacity-50')}>{x.languages.join(', ')}</td>
                  <td className={cx(rejected && 'opacity-50')}>
                    <div className="flex flex-wrap gap-1">
                      {x.formats.map((f) => (
                        <span key={f} className="rounded bg-gray-alpha-200 px-1 text-[11px] whitespace-nowrap">
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={cx('text-right font-mono whitespace-nowrap tabular', rejected && 'opacity-50')}>{x.size}</td>
                  <td className={cx('text-right font-mono whitespace-nowrap tabular', rejected && 'opacity-50')}>{x.age}</td>
                  <td className={cx('pr-4 whitespace-nowrap', rejected && 'opacity-50')}>{x.indexer}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {r && (
        <div className="flex items-center gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px]">
              {r.release} <span className="text-gray-900">· {fmtNum(r.score)} · {r.size} · {r.indexer}</span>
            </div>
            <div className={cx('truncate text-[12px]', r.current ? 'text-gray-900' : g.disabled ? 'text-red-900' : g.reason ? 'text-amber-900' : 'text-gray-900')}>
              {g.reason ?? `Fits the ${slot} Version under Profile ${profile?.name ?? '—'}`}
            </div>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-gray-900">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> select · <Kbd>↵</Kbd> grab · <Kbd>esc</Kbd> back
          </span>
          <Button size="sm" variant={g.label === 'Grab anyway' ? 'secondary' : 'primary'} disabled={g.disabled} prefix={<Download className="size-3.5" />} onClick={grab} title={g.reason}>
            {g.label}
          </Button>
        </div>
      )}
    </div>
  )
}

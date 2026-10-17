// PROTOTYPE, throwaway. Variant A manual search: full-page table of Releases for one Version.
import { useState } from 'react'
import { Ban, Check, RefreshCw } from 'lucide-react'
import { manualSearch, type SearchResult, type Slot, type Title } from '../../mock'
import { go } from '../../nav'
import { useParam } from '../../nav'
import { Badge, Dot, Toggle, cx, fmtNum } from '../../ui'
import { Button, Empty, Page, PageHeader, Table, td, th } from './shell'
import { useStore } from './store'

const qualitySlot = (q: string): Slot => (/2160p/.test(q) ? 'UHD' : /480p|576p/.test(q) ? 'SD' : 'HD')

const RES: Record<Slot, string> = { SD: '480p', HD: '1080p', UHD: '2160p' }

/** The mock list is for Oppenheimer · HD. Re-target it at any Title and Slot (swapping HD and the wanted Slot's resolution) so every Version's manual search looks plausible. */
function resultsFor(t: Title, slot: Slot, profileName: string, hasFile: boolean): SearchResult[] {
  const name = t.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '.').replace(/\.$/, '')
  const stem = t.kind === 'series' ? `${name}.S${String(t.seasons?.at(-1)?.number ?? 1).padStart(2, '0')}` : `${name}.${t.year}`
  const swap = (x: string) => {
    if (slot === 'HD') return x
    return x.replace(/1080p|2160p|480p/g, (m) => (m === RES.HD ? RES[slot] : m === RES[slot] ? RES.HD : m)).replace(/UHD\.BluRay/g, 'BluRay')
  }
  return manualSearch.map((r) => {
    const quality = swap(r.quality)
    const rs = qualitySlot(quality)
    const release = swap(r.release.replace('Oppenheimer.2023', stem))
    let rejections = r.rejections.filter((x) => !x.startsWith('Fits the')).map((x) => swap(x).replace('Profile HD', `Profile ${profileName}`))
    let otherSlot: Slot | undefined
    if (rs !== slot) {
      otherSlot = rs
      rejections = [`Fits the ${rs} Slot, not this Version`]
    } else if (!hasFile) rejections = rejections.filter((x) => !x.startsWith('Not an Upgrade'))
    return { ...r, release, quality, rejections, otherSlot, current: r.current && rs === slot && hasFile }
  })
}

export function ManualSearchScreen() {
  const { titleById, profileById, notify, setQueue } = useStore()
  const id = useParam('id')
  const slot = useParam('slot', 'HD') as Slot
  const t = titleById(id)
  const [hideRejected, setHideRejected] = useState(false)
  const [grabbed, setGrabbed] = useState<string[]>([])
  if (!t) return <Page><Empty>No Title “{id}”.</Empty></Page>
  const v = t.versions.find((x) => x.slot === slot)
  if (!v) return <Page><Empty>{t.title} has no {slot} Version.</Empty></Page>
  const p = profileById(v.profileId)
  const results = resultsFor(t, slot, p.name, !!v.file || (v.episodesHave ?? 0) > 0)
  const shown = hideRejected ? results.filter((r) => r.rejections.length === 0 || r.current) : results
  const current = results.find((r) => r.current)

  const grab = (r: SearchResult) => {
    setGrabbed((g) => [...g, r.release])
    setQueue((q) => [
      { id: `q-${Date.now()}`, titleId: t.id, slot, label: t.title, release: r.release, indexer: r.indexer, phase: 'queued', progress: 0, size: r.size, left: r.size, eta: '—', score: r.score, upgrade: !!current },
      ...q,
    ])
    notify(`Grabbed ${r.release} · sent to SABnzbd`)
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Library', onClick: () => go('library') }, { label: t.title, onClick: () => go('title', { id: t.id }) }, { label: `${slot} Version` }]}
        title="Manual search"
        sub={
          <span className="tabular">
            {t.title} · <span className="font-mono">{slot}</span> Version · Profile {p.name} · {results.length} Releases from 3 indexers, sorted by score
          </span>
        }
        actions={
          <>
            <Toggle on={hideRejected} onChange={setHideRejected} label={<span className="text-[13px] text-gray-900">Hide rejected</span>} />
            <Button size="sm" prefix={<RefreshCw className="size-3.5" />} onClick={() => notify('Searched again · 7 Releases')}>
              Search again
            </Button>
          </>
        }
      />
      <Page>
        {current && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-alpha-400 bg-background-200 px-4 py-3 text-[13px]">
            <Badge tone="green">Current file</Badge>
            <span className="truncate font-mono text-[12px]">{current.release}</span>
            <span className="tabular ml-auto shrink-0 text-gray-900">
              score <span className="font-mono text-gray-1000">{fmtNum(current.score)}</span> · a Grab here replaces only this Version’s file
            </span>
          </div>
        )}
        <Table
          head={
            <>
              <th className={cx(th, 'w-20 text-right')}>Score</th>
              <th className={th}>Release</th>
              <th className={th}>Quality</th>
              <th className={th}>Languages</th>
              <th className={cx(th, 'text-right')}>Size</th>
              <th className={cx(th, 'text-right')}>Age</th>
              <th className={th}>Indexer</th>
              <th className={cx(th, 'w-36 text-right')} />
            </>
          }
        >
          {shown.map((r) => {
            const rejected = r.rejections.length > 0
            const blocked = r.blocklisted || !!r.otherSlot
            const isGrabbed = grabbed.includes(r.release)
            return (
              <tr key={r.release} className={cx('align-top', r.current ? 'bg-green-100' : 'hover:bg-gray-alpha-100')}>
                <td className={cx(td, 'tabular text-right font-mono text-[13px] font-medium', rejected && !r.current && 'text-gray-700')}>{fmtNum(r.score)}</td>
                <td className={cx(td, 'max-w-[560px]')}>
                  <div className={cx('flex items-center gap-2', rejected && !r.current && 'opacity-60')}>
                    {r.current && <Badge tone="green">Current file</Badge>}
                    <span className="truncate font-mono text-[12px]" title={r.release}>
                      {r.release}
                    </span>
                  </div>
                  <div className={cx('mt-1 flex flex-wrap gap-1', rejected && !r.current && 'opacity-60')}>
                    {r.formats.map((f) => (
                      <span key={f} className="rounded border border-gray-alpha-400 bg-background-200 px-1.5 text-[11px] leading-[18px] text-gray-900">
                        {f}
                      </span>
                    ))}
                  </div>
                  {rejected && !r.current && (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {r.rejections.map((x) => (
                        <li key={x} className={cx('flex items-center gap-1.5 text-[12px]', blocked ? 'text-red-900' : 'text-amber-900')}>
                          {r.blocklisted ? <Ban className="size-3" /> : <Dot tone={blocked ? 'red' : 'amber'} />}
                          {x}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={cx(td, 'whitespace-nowrap', rejected && !r.current && 'text-gray-900')}>{r.quality}</td>
                <td className={cx(td, 'whitespace-nowrap text-gray-900')}>{r.languages.join(', ')}</td>
                <td className={cx(td, 'tabular whitespace-nowrap text-right text-gray-900')}>{r.size}</td>
                <td className={cx(td, 'tabular whitespace-nowrap text-right text-gray-900')}>{r.age}</td>
                <td className={cx(td, 'text-gray-900')}>{r.indexer}</td>
                <td className={cx(td, 'text-right')}>
                  {r.current ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-green-900">
                      <Check className="size-3.5" /> In library
                    </span>
                  ) : isGrabbed ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-blue-900">
                      <Check className="size-3.5" /> Grabbed
                    </span>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <Button size="sm" variant={rejected ? 'secondary' : 'primary'} disabled={blocked} onClick={() => grab(r)}>
                        {rejected && !blocked ? 'Grab anyway' : 'Grab'}
                      </Button>
                      {blocked && <span className="text-[11px] text-gray-900">{r.blocklisted ? 'Blocklisted' : `For the ${r.otherSlot} Slot`}</span>}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
        <p className="mt-3 text-[12px] text-gray-900">
          Rejected Releases can still be grabbed. Blocklisted Releases and Releases that fit another Slot can’t: remove the entry from the Blocklist, or search from that Slot’s Version instead.
        </p>
      </Page>
    </>
  )
}

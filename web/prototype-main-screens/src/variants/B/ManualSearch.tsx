// PROTOTYPE, throwaway. Variant B · Posters: manual search as a second, wider sheet stacked over the Title sheet.
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Ban, Check, CircleAlert, Clock, FileCheck, HardDrive, Languages, Monitor, Server, TriangleAlert } from 'lucide-react'
import { go, navigate, useParam } from '../../nav'
import { manualSearch, profileById, type SearchResult, type Slot, type Title, type Version } from '../../mock'
import { Badge, Kbd, cx, fmtNum } from '../../ui'
import { Button, CloseButton, Segmented, Sheet, updateVersion, useStore } from './common'

/** The mock only has Oppenheimer · HD; rename and re-slot it for any Title and Slot. */
function releasesFor(t: Title, slot: Slot, v?: Version): SearchResult[] {
  const slug = `${t.title.replace(/[^A-Za-z0-9]+/g, '.').replace(/\.$/, '')}.${t.year}`
  const rn = (s: string) => s.replace('Oppenheimer.2023', slug)
  const pname = v ? profileById(v.profileId).name : slot
  let list: SearchResult[] = manualSearch.map((r) => ({ ...r, release: rn(r.release), rejections: r.rejections.map((x) => x.replace('Profile HD', `Profile ${pname}`)) }))
  if (slot !== 'HD') {
    list = list.map((r) => {
      if (r.otherSlot === slot) return { ...r, otherSlot: undefined, rejections: [] }
      if (!r.otherSlot && !r.blocklisted) return { ...r, current: false, otherSlot: 'HD' as Slot, rejections: ['Fits the HD Slot, not this Version'] }
      return r
    })
    if (slot === 'SD')
      list.unshift({ release: rn('Oppenheimer.2023.German.DL.576p.BluRay.x264-iNKLUSiON'), indexer: 'NZBgeek', size: '2.4 GB', age: '318 d', quality: 'Bluray-576p', languages: ['German', 'English'], score: 10400, formats: ['German DL', 'German Bluray Tier 02'], rejections: [] })
  }
  if (!v?.file) list = list.map((r) => ({ ...r, current: false, rejections: r.rejections.filter((x) => !x.startsWith('Not an Upgrade')) }))
  if (t.kind === 'series') list = list.map((r) => ({ ...r, release: r.release.replace(`.${t.year}.`, '.S01.') }))
  return list
}

type Sort = 'score' | 'size' | 'age'
const sizeGb = (s: string) => parseFloat(s) * (s.includes('MB') ? 0.001 : 1)

export function ManualSearchSheet({ id }: { id: string }) {
  const { titles } = useStore()
  const slot = useParam('slot', 'HD') as Slot
  const t = titles.find((x) => x.id === id)
  const back = () => go('title', { id })
  const [sort, setSort] = useState<Sort>('score')
  const [grabbable, setGrabbable] = useState<'all' | 'ok'>('all')
  const v = t?.versions.find((x) => x.slot === slot)
  const all = useMemo(() => (t ? releasesFor(t, slot, v) : []), [t, slot, v])
  let list = grabbable === 'ok' ? all.filter((r) => !r.blocklisted && !r.otherSlot) : all
  list = [...list].sort((a, b) => (sort === 'score' ? b.score - a.score : sort === 'size' ? sizeGb(b.size) - sizeGb(a.size) : parseInt(a.age) - parseInt(b.age)))
  const indexers = new Set(all.map((r) => r.indexer)).size

  return (
    <Sheet onClose={back} width={900} z={50} label="Manual search">
      <div className="shrink-0 border-b border-gray-alpha-400 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button onClick={back} title="Back to Title" className="mt-0.5 inline-flex size-8 items-center justify-center rounded-md border border-gray-alpha-400 hover:bg-gray-alpha-100">
              <ArrowLeft size={15} />
            </button>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Manual search</h2>
              <p className="text-[13px] text-gray-900">
                {t?.title ?? id} · <span className="font-mono text-gray-1000">{slot}</span> Version · Profile {v ? profileById(v.profileId).name : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>Esc</Kbd>
            <CloseButton onClick={back} label="Back to Title" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="tabular text-[13px] text-gray-900">
            {all.length} Releases from {indexers} indexers · searched just now
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Segmented size="sm" value={grabbable} onChange={setGrabbable} options={[{ value: 'all', label: 'All' }, { value: 'ok', label: 'Fits this Version' }]} />
            <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'score', label: 'Score' }, { value: 'size', label: 'Size' }, { value: 'age', label: 'Age' }]} />
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-background-200 p-5">
        {t && list.map((r) => <ReleaseCard key={r.release} t={t} slot={slot} r={r} hasOtherVersion={!!r.otherSlot && t.versions.some((x) => x.slot === r.otherSlot)} />)}
        <p className="pt-2 text-center text-[12px] text-gray-900">Scores come from the Profile’s TRaSH custom formats. Rejected Releases can still be grabbed, except blocklisted ones and ones that fit another Slot.</p>
      </div>
    </Sheet>
  )
}

function ReleaseCard({ t, slot, r, hasOtherVersion }: { t: Title; slot: Slot; r: SearchResult; hasOtherVersion: boolean }) {
  const { update, toast } = useStore()
  const [grabbed, setGrabbed] = useState(false)
  const hard = r.blocklisted || !!r.otherSlot
  const rejected = r.rejections.length > 0
  const grab = () => {
    setGrabbed(true)
    update(t.id, (x) => updateVersion(x, slot, (y) => ({ ...y, state: 'downloading', progress: 0 })))
    toast(`Grabbed ${r.release} for the ${slot} Version`)
  }
  return (
    <div className={cx('rounded-lg border bg-background-100 p-4', r.current ? 'border-blue-700 ring-1 ring-blue-700' : 'border-gray-alpha-400', hard && 'opacity-80')}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {r.current && <Badge tone="blue"><FileCheck size={11} /> Current file</Badge>}
            {r.blocklisted && <Badge tone="red"><Ban size={11} /> Blocklisted</Badge>}
            {r.otherSlot && <Badge tone="gray">Fits {r.otherSlot}</Badge>}
          </div>
          <div className={cx('font-mono text-[13px] leading-snug font-medium break-all', (r.current || r.blocklisted || r.otherSlot) && 'mt-1.5')}>{r.release}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-900">
            <Meta icon={<Monitor size={12} />}>{r.quality}</Meta>
            <Meta icon={<Languages size={12} />}>{r.languages.join(', ')}</Meta>
            <Meta icon={<HardDrive size={12} />}><span className="tabular">{r.size}</span></Meta>
            <Meta icon={<Clock size={12} />}><span className="tabular">{r.age}</span></Meta>
            <Meta icon={<Server size={12} />}>{r.indexer}</Meta>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cx('tabular font-mono text-[26px] leading-none font-semibold tracking-tight', r.score === 0 ? 'text-gray-700' : 'text-gray-1000')}>{fmtNum(r.score)}</div>
          <div className="mt-1 text-[11px] text-gray-900">score</div>
        </div>
      </div>

      {r.formats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.formats.map((f) => <Badge key={f} mono className="text-[10px]">{f}</Badge>)}
        </div>
      )}

      {rejected && (
        <div className={cx('mt-3 rounded-md px-3 py-2 text-[12px]', hard ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-900')}>
          {r.rejections.map((x) => (
            <div key={x} className="flex items-start gap-1.5">
              {hard ? <CircleAlert size={13} className="mt-px shrink-0" /> : <TriangleAlert size={13} className="mt-px shrink-0" />}
              <span>{x}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-3 border-t border-gray-alpha-400 pt-3">
        {r.blocklisted && <span className="mr-auto text-[12px] text-gray-900">Blocklisted Releases are never grabbed again. Remove it from the Blocklist in Activity first.</span>}
        {r.otherSlot && (
          <span className="mr-auto text-[12px] text-gray-900">
            A Release only fills the Version whose Profile it matches.
            {hasOtherVersion && (
              <button className="ml-1 text-gray-1000 underline" onClick={() => navigate({ slot: r.otherSlot! })}>Search the {r.otherSlot} Version</button>
            )}
          </span>
        )}
        {r.current ? (
          <span className="text-[12px] text-gray-900">This is the Version’s current file</span>
        ) : grabbed ? (
          <Button size="sm" disabled prefix={<Check size={14} />}>Grabbed</Button>
        ) : hard ? (
          <Button size="sm" disabled title={r.rejections[0]}>Grab</Button>
        ) : rejected ? (
          <Button size="sm" onClick={grab}>Grab anyway</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={grab}>Grab</Button>
        )}
      </div>
    </div>
  )
}

const Meta = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1">
    <span className="text-gray-700">{icon}</span>
    {children}
  </span>
)

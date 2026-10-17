// PROTOTYPE, throwaway. Variant A "Add Title": a modal over the current page, search then confirm.
import { useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { TODAY, addResults, type AddResult, type Slot, type Title } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Poster, Select, Toggle, cx } from '../../ui'
import { Button, Dialog, Input, Segmented } from './shell'
import { useStore } from './store'

const fskNum = (c: string) => Number(c.match(/\d+/)?.[0] ?? 99)

export function AddDialog() {
  const add = useParam('add')
  const screen = useParam('screen')
  const open = add === '1' || screen === 'add'
  const close = () => (screen === 'add' ? go('library') : navigate({ add: null }))
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<AddResult | null>(null)
  const { titles } = useStore()
  if (!open) return null
  const inLib = (r: AddResult) => r.inLibrary || titles.some((t) => t.tmdbId === r.tmdbId)
  const results = addResults.filter((r) => !q || `${r.title} ${r.primaryTitle ?? ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <Dialog
      open
      width="max-w-2xl"
      onClose={() => {
        setPick(null)
        close()
      }}
      title={pick ? `Add ${pick.kind === 'movie' ? 'Movie' : 'Series'}` : 'Add Title'}
    >
      {!pick ? (
        <>
          <Input autoFocus prefix={<Search className="size-4" />} placeholder="Search TMDB for Movies and Series…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-1.5 text-[12px] text-gray-900">One search for both kinds. Series must also be on TheTVDB.</div>
          <ul className="mt-3 max-h-[420px] divide-y divide-gray-alpha-400 overflow-y-auto rounded-lg border border-gray-alpha-400">
            {results.map((r) => {
              const lib = inLib(r)
              const disabled = lib || r.notOnTvdb
              return (
                <li key={r.tmdbId}>
                  <button
                    disabled={disabled}
                    onClick={() => setPick(r)}
                    className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left', disabled ? 'cursor-not-allowed' : 'hover:bg-gray-alpha-100')}
                  >
                    <Poster title={r.title} hue={r.hue} small className={cx('w-9 rounded', disabled && 'opacity-50')} />
                    <div className={cx('min-w-0 flex-1', disabled && 'opacity-60')}>
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="font-medium">{r.title}</span>
                        <span className="tabular text-gray-900">{r.year}</span>
                        <Badge tone={r.kind === 'movie' ? 'gray' : 'purple'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
                        <span className="text-[12px] text-gray-900">{r.certification}</span>
                      </div>
                      {r.primaryTitle && <div className="text-[12px] text-gray-900">{r.primaryTitle}</div>}
                      <div className="truncate text-[12px] text-gray-900">{r.overview}</div>
                    </div>
                    {lib ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          const t = titles.find((x) => x.tmdbId === r.tmdbId)
                          if (t) go('title', { id: t.id })
                        }}
                        className="shrink-0 cursor-pointer"
                      >
                        <Badge tone="green">In library</Badge>
                      </span>
                    ) : r.notOnTvdb ? (
                      <span className="shrink-0 text-[12px] text-red-900">Not on TheTVDB, can’t be added</span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-gray-900">Select →</span>
                    )}
                  </button>
                </li>
              )
            })}
            {results.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-gray-900">No TMDB results for “{q}”.</li>}
          </ul>
        </>
      ) : (
        <Confirm r={pick} onBack={() => setPick(null)} onDone={() => setPick(null)} />
      )}
    </Dialog>
  )
}

function Confirm({ r, onBack, onDone }: { r: AddResult; onBack: () => void; onDone: () => void }) {
  const { profiles, settings, setTitles, notify } = useStore()
  const kidsHit = settings.kidsRule.on && fskNum(r.certification) <= settings.kidsRule.threshold
  const slotProfiles = (s: Slot) => profiles.filter((p) => p.slot === s && p.enabled)
  const defaultFor = (s: Slot) => slotProfiles(s).find((p) => p.defaultFor.includes(r.kind)) ?? slotProfiles(s)[0]
  const hdProfile = kidsHit ? profiles.find((p) => p.id === 'kids')! : defaultFor('HD')
  const [hd, setHd] = useState(hdProfile.id)
  const [extra, setExtra] = useState<Record<'SD' | 'UHD', { on: boolean; pid: string }>>({ SD: { on: false, pid: defaultFor('SD').id }, UHD: { on: false, pid: defaultFor('UHD').id } })
  const [monitoring, setMonitoring] = useState<Title['monitoring']>('All')
  const folders = settings.rootFolders.filter((f) => f.kind === r.kind).map((f) => f.path)
  const [folder, setFolder] = useState(folders[0])
  const name = (id: string) => profiles.find((p) => p.id === id)!.name

  const add = () => {
    const id = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const slots: { slot: Slot; pid: string }[] = [...(extra.SD.on ? [{ slot: 'SD' as Slot, pid: extra.SD.pid }] : []), { slot: 'HD', pid: hd }, ...(extra.UHD.on ? [{ slot: 'UHD' as Slot, pid: extra.UHD.pid }] : [])]
    const t: Title = {
      id, kind: r.kind, title: r.title, primaryTitle: r.primaryTitle, year: r.year, tmdbId: r.tmdbId, tvdbId: r.kind === 'series' ? 121361 : undefined, imdbId: 'tt0000000',
      overview: r.overview, runtime: '—', certification: r.certification, originalLanguage: 'English', genres: [], status: r.kind === 'series' ? 'Ended' : 'Released', monitoring,
      folder: `${folder}/${r.title} (${r.year}) {${r.kind === 'movie' ? 'tmdb-' + r.tmdbId : 'tvdb-121361'}}`, hue: r.hue,
      versions: slots.map((s) => ({ slot: s.slot, profileId: s.pid, state: 'missing', missingSince: TODAY, lastSearched: TODAY, ...(r.kind === 'series' ? { episodesHave: 0, episodesWanted: 73 } : {}) })),
      seasons: r.kind === 'series' ? [] : undefined,
    }
    setTitles((ts) => [...ts.filter((x) => x.id !== id), t])
    notify(`${r.title} added with ${slots.map((s) => s.slot).join(' + ')} · searching`)
    onDone()
    go('title', { id })
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] text-gray-900 hover:text-gray-1000">
        <ArrowLeft className="size-3.5" /> Back to results
      </button>
      <div className="flex gap-4 rounded-lg border border-gray-alpha-400 bg-background-200 p-3">
        <Poster title={r.title} hue={r.hue} small className="w-12 rounded" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{r.title}</span>
            <span className="tabular text-[13px] text-gray-900">{r.year}</span>
            <Badge tone={r.kind === 'movie' ? 'gray' : 'purple'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
            <span className="text-[12px] text-gray-900">{r.certification}</span>
          </div>
          {r.primaryTitle && <div className="text-[13px] text-gray-900">{r.primaryTitle}</div>}
          <div className="mt-0.5 line-clamp-2 text-[12px] text-gray-900">{r.overview}</div>
        </div>
      </div>

      <div className="mt-4 text-[11px] font-medium uppercase tracking-wide text-gray-700">Versions</div>
      <div className="mt-1.5 divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="w-10 font-mono text-[13px] font-semibold">HD</span>
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-medium">
              HD · {name(hd)}
              {hd === hdProfile.id && kidsHit && ` (FSK ${settings.kidsRule.threshold})`}
            </div>
            <div className="text-[12px] text-gray-900">
              {hd !== hdProfile.id ? 'Changed by you' : kidsHit ? `Preselected by the Kids rule (${r.certification} ≤ FSK ${settings.kidsRule.threshold})` : `Preselected: default for new ${r.kind === 'movie' ? 'Movies' : 'Series'}`}
            </div>
          </div>
          <Select className="h-8 w-44 text-[13px]" value={name(hd)} options={slotProfiles('HD').map((p) => p.name)} onChange={(n) => setHd(slotProfiles('HD').find((p) => p.name === n)!.id)} />
        </div>
        {(['SD', 'UHD'] as const).map((s) => (
          <div key={s} className="flex items-center gap-3 px-3 py-2.5">
            <span className={cx('w-10 font-mono text-[13px] font-semibold', !extra[s].on && 'text-gray-700')}>{s}</span>
            <div className="flex-1">
              <Toggle on={extra[s].on} onChange={(on) => setExtra({ ...extra, [s]: { ...extra[s], on } })} label={<span className="text-[13px]">Also add {s}</span>} />
            </div>
            <Select
              className={cx('h-8 w-44 text-[13px]', !extra[s].on && 'opacity-50')}
              value={name(extra[s].pid)}
              options={slotProfiles(s).map((p) => p.name)}
              onChange={(n) => setExtra({ ...extra, [s]: { on: true, pid: slotProfiles(s).find((p) => p.name === n)!.id } })}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {r.kind === 'series' && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-700">Monitoring</div>
            <Segmented size="sm" value={monitoring} onChange={setMonitoring} options={(['All', 'Future only', 'None'] as const).map((k) => ({ key: k, label: k }))} />
          </div>
        )}
        <div className={r.kind === 'movie' ? 'col-span-2' : ''}>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-700">Root folder</div>
          <Select className="h-8 w-full font-mono text-[12px]" value={folder} options={folders} onChange={setFolder} />
        </div>
      </div>

      <div className="-mx-5 -mb-4 mt-5 flex items-center justify-between rounded-b-xl border-t border-gray-alpha-400 bg-background-200 px-5 py-3">
        <span className="text-[12px] text-gray-900">Kestrel searches each Version right after adding.</span>
        <div className="flex gap-2">
          <Button size="sm" onClick={onBack}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={add}>
            Add {r.kind === 'movie' ? 'Movie' : 'Series'}
          </Button>
        </div>
      </div>
    </div>
  )
}

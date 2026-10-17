// PROTOTYPE, throwaway. Variant B · Posters: Add as a centred command-style dialog that flips to a confirm view.
import { useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Baby, CornerDownLeft, Search, Sparkles } from 'lucide-react'
import { go } from '../../nav'
import { addResults, profileById, settings, SLOTS, TODAY, type AddResult, type Kind, type Slot, type Title } from '../../mock'
import { Badge, Kbd, Poster, cx } from '../../ui'
import { Button, Checkbox, Dialog, Field, IdSelect, Segmented, useStore } from './common'
import { defaultProfileFor, slotProfiles } from './TitleSheet'

export function AddDialog() {
  const [picked, setPicked] = useState<AddResult | null>(null)
  const close = () => go('library')
  return (
    <Dialog onClose={picked ? () => setPicked(null) : close} width={680} top label="Add a Title">
      {picked ? <Confirm r={picked} onBack={() => setPicked(null)} /> : <Results onPick={setPicked} />}
    </Dialog>
  )
}

function Results({ onPick }: { onPick: (r: AddResult) => void }) {
  const { titles } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = addResults
    .map((r) => ({ ...r, inLibrary: r.inLibrary || titles.some((t) => t.tmdbId === r.tmdbId) }))
    .filter((r) => !q.trim() || r.title.toLowerCase().includes(q.toLowerCase()) || r.primaryTitle?.toLowerCase().includes(q.toLowerCase()))
  const choose = (r: AddResult) => {
    if (r.notOnTvdb) return
    if (r.inLibrary) {
      const t = titles.find((x) => x.tmdbId === r.tmdbId)
      if (t) go('title', { id: t.id })
      return
    }
    onPick(r)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, list.length - 1)))
    if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
    if (e.key === 'Enter' && list[sel]) choose(list[sel])
  }
  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-alpha-400 px-5">
        <Search size={20} className="shrink-0 text-gray-900" />
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          onKeyDown={onKey}
          placeholder="Search Movies and Series on TMDB…"
          className="h-16 w-full bg-transparent text-lg tracking-tight outline-none placeholder:text-gray-700"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div className="overflow-y-auto p-2">
        <div className="px-3 pt-2 pb-1.5 text-[12px] font-medium text-gray-900">{q ? `Results for “${q}”` : 'Results'} · Movies and Series together</div>
        {list.length === 0 && <p className="px-3 py-8 text-center text-sm text-gray-900">Nothing on TMDB matches “{q}”.</p>}
        {list.map((r, i) => (
          <button
            key={r.tmdbId}
            onMouseEnter={() => setSel(i)}
            onClick={() => choose(r)}
            disabled={r.notOnTvdb}
            title={r.notOnTvdb ? 'Not on TheTVDB: Kestrel needs TheTVDB for a Series’ episodes' : undefined}
            className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed', i === sel && 'bg-gray-alpha-100')}
          >
            <Poster title={r.title} hue={r.hue} small className={cx('w-10', r.notOnTvdb && 'opacity-50')} />
            <div className={cx('min-w-0 flex-1', r.notOnTvdb && 'opacity-60')}>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{r.title}</span>
                <span className="tabular text-[13px] text-gray-900">{r.year}</span>
              </div>
              <div className="truncate text-[12px] text-gray-900">
                {r.primaryTitle && r.primaryTitle !== r.title ? <>{r.primaryTitle} · </> : null}
                {r.overview}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge tone={r.kind === 'movie' ? 'gray' : 'teal'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
              {r.certification !== '—' && <Badge>{r.certification}</Badge>}
              {r.inLibrary && <Badge tone="green">In library</Badge>}
              {r.notOnTvdb && <Badge tone="amber" className="cursor-help">Not on TheTVDB</Badge>}
              {i === sel && !r.notOnTvdb && <CornerDownLeft size={14} className="ml-1 text-gray-900" />}
            </div>
          </button>
        ))}
        {list.some((r) => r.notOnTvdb) && (
          <p className="px-3 pt-2 pb-1 text-[12px] text-gray-900">A Series needs a TheTVDB entry for its episodes, so Series found only on TMDB can’t be added.</p>
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-gray-alpha-400 bg-background-200 px-5 py-2.5 text-[12px] text-gray-900">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
        <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> to pick</span>
        <span className="ml-auto">Metadata from TMDB</span>
      </div>
    </>
  )
}

function Confirm({ r, onBack }: { r: AddResult; onBack: () => void }) {
  const { addTitle, toast } = useStore()
  const kids = settings.kidsRule.on && /FSK (0|6)$/.test(r.certification)
  const [slots, setSlots] = useState<Record<Slot, { on: boolean; pid: string }>>(() => ({
    SD: { on: false, pid: defaultProfileFor('SD', r.certification) },
    HD: { on: true, pid: defaultProfileFor('HD', r.certification) },
    UHD: { on: false, pid: defaultProfileFor('UHD', r.certification) },
  }))
  const [monitoring, setMonitoring] = useState<'All' | 'Future only' | 'None'>('All')
  const [root, setRoot] = useState(settings.rootFolders.find((f) => f.kind === r.kind)!.path)
  const [searchNow, setSearchNow] = useState(true)
  const folder = `${root}/${r.title.replace(/:/g, '')} (${r.year}) {${r.kind === 'movie' ? 'tmdb' : 'tvdb'}-${r.tmdbId}}`
  const count = SLOTS.filter((s) => slots[s].on).length
  const hd = profileById(slots.HD.pid)

  const add = () => {
    const id = `${r.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${r.tmdbId}`
    const t: Title = {
      id, kind: r.kind as Kind, title: r.title, primaryTitle: r.primaryTitle, year: r.year, tmdbId: r.tmdbId, tvdbId: r.kind === 'series' ? 121361 : undefined, imdbId: 'tt0944947',
      overview: r.overview, runtime: '—', certification: r.certification, originalLanguage: 'English', genres: [], status: r.kind === 'series' ? 'Ended' : 'Released',
      monitoring, folder, hue: r.hue, seasons: r.kind === 'series' ? [] : undefined,
      versions: SLOTS.filter((s) => slots[s].on).map((s) => ({ slot: s, profileId: slots[s].pid, state: 'missing' as const, missingSince: TODAY, lastSearched: searchNow ? TODAY : undefined })),
    }
    addTitle(t)
    toast(`${r.title} added with ${count} ${count === 1 ? 'Version' : 'Versions'}${searchNow ? ' · searching' : ''}`)
    go('title', { id })
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-4 py-3">
        <button onClick={onBack} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-gray-alpha-200" title="Back to results">
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium">Add {r.kind === 'movie' ? 'Movie' : 'Series'}</span>
      </div>
      <div className="space-y-5 overflow-y-auto p-5">
        <div className="flex gap-4">
          <Poster title={r.title} hue={r.hue} className="w-24" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{r.title}</h2>
            {r.primaryTitle && r.primaryTitle !== r.title && <div className="text-sm text-gray-900">{r.primaryTitle}</div>}
            <div className="mt-1 flex gap-1.5">
              <Badge tone={r.kind === 'movie' ? 'gray' : 'teal'}>{r.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
              <Badge>{r.year}</Badge>
              <Badge>{r.certification}</Badge>
            </div>
            <p className="mt-2 text-[13px] text-gray-900">{r.overview}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-blue-700/40 bg-blue-100 px-4 py-3">
          {kids ? <Baby size={18} className="text-blue-900" /> : <Sparkles size={18} className="text-blue-900" />}
          <div>
            <div className="text-[15px] font-semibold tracking-tight">
              <span className="font-mono">HD</span> · {hd.name}
            </div>
            <div className="text-[13px] text-gray-900">
              {kids ? `Preselected because ${r.certification} (Kids rule: FSK ${settings.kidsRule.threshold} or lower)` : `Preselected: the default HD Profile for new ${r.kind === 'movie' ? 'Movies' : 'Series'}`}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-gray-900">Versions</div>
          <div className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
            {SLOTS.map((s) => (
              <div key={s} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox checked={slots[s].on} onChange={(on) => setSlots((x) => ({ ...x, [s]: { ...x[s], on } }))} label={<span className="w-10 font-mono text-[13px] font-semibold">{s}</span>} />
                <span className="flex-1 text-[12px] text-gray-900">{s === 'HD' ? 'Standard Slot' : 'Opt-in'}</span>
                <IdSelect className="w-44" disabled={!slots[s].on} value={slots[s].pid} options={slotProfiles(s)} onChange={(pid) => setSlots((x) => ({ ...x, [s]: { ...x[s], pid } }))} />
              </div>
            ))}
          </div>
          {count === 0 && <p className="mt-1.5 text-[12px] text-red-900">A Title needs at least one Version.</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {r.kind === 'series' && (
            <Field label="Monitoring">
              <Segmented value={monitoring} onChange={setMonitoring} options={(['All', 'Future only', 'None'] as const).map((m) => ({ value: m, label: m }))} />
            </Field>
          )}
          <Field label="Root folder">
            <IdSelect className="h-9 w-full font-mono" value={root} onChange={setRoot} options={settings.rootFolders.map((f) => ({ id: f.path, label: `${f.path} · ${f.free} free` }))} />
          </Field>
        </div>
        <div className="font-mono text-[12px] break-all text-gray-900">{folder}</div>
        <Checkbox checked={searchNow} onChange={setSearchNow} label="Start searching for the Versions right away" />
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-alpha-400 bg-background-200 px-5 py-3">
        <Button size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" variant="primary" disabled={count === 0} onClick={add}>
          Add {r.kind === 'movie' ? 'Movie' : 'Series'}
        </Button>
      </div>
    </>
  )
}

// PROTOTYPE, throwaway. Variant A Title detail: full page, header with metadata, tabs Versions / Episodes / Files / History.
import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FolderOpen, ListFilter, RefreshCw, Search, Trash2, TriangleAlert } from 'lucide-react'
import { SLOTS, TODAY, daysBetween, history, type Episode, type Slot, type Title, type Version } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Dot, Poster, Select, Toggle, cx, fmtNum, versionStatus } from '../../ui'
import { Button, Checkbox, Dialog, Empty, Page, Segmented, Table, Tabs, td, th } from './shell'
import { eventTone, fmtDate, useStore } from './store'

export function TitleScreen() {
  const id = useParam('id')
  const { titleById } = useStore()
  const t = titleById(id)
  const tab = useParam('tab', 'versions')
  if (!t)
    return (
      <Page>
        <Empty>
          No Title “{id}”.{' '}
          <button className="underline" onClick={() => go('library')}>
            Back to Library
          </button>
        </Empty>
      </Page>
    )
  const tabs = [
    { key: 'versions', label: 'Versions', count: t.versions.length },
    ...(t.kind === 'series' ? [{ key: 'episodes', label: 'Episodes', count: t.seasons?.reduce((n, s) => n + s.episodes.length, 0) }] : []),
    { key: 'files', label: 'Files' },
    { key: 'history', label: 'History', count: history.filter((h) => h.titleId === t.id).length },
  ]
  return (
    <>
      <TitleHeader t={t}>
        <Tabs tabs={tabs} value={tab} />
      </TitleHeader>
      <Page>
        {tab === 'versions' && <VersionsTab t={t} />}
        {tab === 'episodes' && t.kind === 'series' && <EpisodesTab t={t} />}
        {tab === 'files' && <FilesTab t={t} />}
        {tab === 'history' && <HistoryTab t={t} />}
      </Page>
    </>
  )
}

function IdLink({ label, value, href }: { label: string; value: string | number; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-gray-alpha-400 px-1.5 py-0.5 font-mono text-[11px] text-gray-900 hover:text-gray-1000">
      <span className="text-gray-700">{label}</span>
      {value}
      <ExternalLink className="size-3" />
    </a>
  )
}

function TitleHeader({ t, children }: { t: Title; children: React.ReactNode }) {
  const { updateTitle, notify } = useStore()
  const meta = [String(t.year), t.certification, t.runtime, `Original Language: ${t.originalLanguage}`, t.status, t.genres.join(', ')]
  return (
    <header className="border-b border-gray-alpha-400 bg-background-100">
      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <div className="mb-4 flex items-center gap-1 text-[13px] text-gray-900">
          <button onClick={() => go('library')} className="hover:text-gray-1000">
            Library
          </button>
          <ChevronRight className="size-3.5 text-gray-600" />
          <button onClick={() => go('library', { kind: t.kind })} className="hover:text-gray-1000">
            {t.kind === 'movie' ? 'Movies' : 'Series'}
          </button>
          <ChevronRight className="size-3.5 text-gray-600" />
          <span className="text-gray-1000">{t.title}</span>
        </div>
        <div className="flex gap-6 pb-5">
          <Poster title={t.title} hue={t.hue} className="w-28" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">{t.title}</h1>
                  <Badge tone={t.kind === 'movie' ? 'gray' : 'purple'}>{t.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
                </div>
                {t.primaryTitle && t.primaryTitle !== t.title && <div className="mt-0.5 text-[15px] text-gray-900">{t.primaryTitle}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" prefix={<RefreshCw className="size-3.5" />} onClick={() => notify('Metadata refreshed from TMDB' + (t.tvdbId ? ' and TheTVDB' : ''))}>
                  Refresh metadata
                </Button>
                <Button size="sm" variant="primary" prefix={<Search className="size-3.5" />} onClick={() => notify(`Searching all ${t.versions.length} Versions of ${t.title}`)}>
                  Search all Versions
                </Button>
              </div>
            </div>
            <div className="tabular mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-gray-900">
              {meta.map((m, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="text-gray-600">·</span>}
                  {m}
                </span>
              ))}
            </div>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-gray-900">{t.overview}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <IdLink label="TMDB" value={t.tmdbId} href={`https://www.themoviedb.org/${t.kind === 'movie' ? 'movie' : 'tv'}/${t.tmdbId}`} />
              {t.tvdbId && <IdLink label="TVDB" value={t.tvdbId} href={`https://thetvdb.com/dereferrer/series/${t.tvdbId}`} />}
              <IdLink label="IMDb" value={t.imdbId} href={`https://www.imdb.com/title/${t.imdbId}/`} />
              <span className="mx-1 h-4 w-px bg-gray-alpha-400" />
              <span className="font-mono text-[11px] text-gray-900" title={t.folder}>
                {t.folder}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="text-gray-900">Monitoring</span>
                {t.kind === 'series' ? (
                  <Segmented
                    size="sm"
                    value={t.monitoring}
                    onChange={(v) => updateTitle(t.id, (x) => ({ ...x, monitoring: v }))}
                    options={(['All', 'Future only', 'None'] as const).map((k) => ({ key: k, label: k }))}
                  />
                ) : (
                  <Toggle on={t.monitoring === 'All'} onChange={(on) => updateTitle(t.id, (x) => ({ ...x, monitoring: on ? 'All' : 'None' }))} label={t.monitoring === 'All' ? 'Monitored' : 'Not monitored'} />
                )}
              </div>
              {t.request ? (
                <div className="flex items-center gap-2">
                  <Dot tone="purple" />
                  <span>
                    Requested by <span className="font-medium">{t.request.by}</span> via {t.request.source} · <span className="font-mono text-[12px]">{t.request.slots.join(', ')}</span> ·{' '}
                    <span className="tabular">{t.request.at.slice(0, 10)}</span>
                  </span>
                </div>
              ) : (
                <span className="text-gray-900">Added in Kestrel, not a Request</span>
              )}
              {t.releaseDates && (
                <div className="tabular flex items-center gap-3 text-gray-900">
                  {t.releaseDates.theatrical && <span>Theatrical (DE) {t.releaseDates.theatrical}</span>}
                  {t.releaseDates.digital && <span>Digital {t.releaseDates.digital}</span>}
                  {t.releaseDates.physical && <span>Physical {t.releaseDates.physical}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
        {children}
      </div>
    </header>
  )
}

// ── Versions ────────────────────────────────────────────────────────────────

/** For a Series Version: summarise the episode files of that Slot. */
function seriesFileSummary(t: Title, slot: Slot) {
  const files = (t.seasons ?? []).flatMap((s) => s.episodes.map((e) => e.files[slot])).filter((f): f is { quality: string; score: number; languages: string[] } => typeof f === 'object')
  if (!files.length) return null
  const langs = [...new Set(files.flatMap((f) => f.languages))]
  const scores = files.map((f) => f.score)
  return { quality: [...new Set(files.map((f) => f.quality))].join(', '), languages: langs, min: Math.min(...scores), max: Math.max(...scores) }
}

function VersionsTab({ t }: { t: Title }) {
  const addSlot = useParam('addSlot')
  return (
    <div className="flex flex-col gap-3">
      {SLOTS.map((slot) => {
        const v = t.versions.find((x) => x.slot === slot)
        return v ? <VersionRow key={slot} t={t} v={v} /> : <EmptySlotRow key={slot} t={t} slot={slot} highlight={addSlot === slot} />
      })}
      <p className="mt-1 text-[12px] text-gray-900">
        A Title has at most one Version per Slot. Each Version is filled and upgraded on its own; a Release only ever replaces the file of the Version whose Profile it matches.
      </p>
    </div>
  )
}

function SlotLabel({ slot }: { slot: Slot }) {
  return <div className="flex h-9 w-14 items-center justify-center rounded-md border border-gray-alpha-400 bg-background-200 font-mono text-[13px] font-semibold">{slot}</div>
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-700">{label}</div>
      <div className="mt-0.5 truncate text-[13px]">{children}</div>
    </div>
  )
}

function VersionRow({ t, v }: { t: Title; v: Version }) {
  const { profiles, profileById, updateVersion, updateTitle, notify, settings } = useStore()
  const [removing, setRemoving] = useState(false)
  const [alsoDelete, setAlsoDelete] = useState(false)
  const s = versionStatus(v)
  const p = profileById(v.profileId)
  const slotProfiles = profiles.filter((x) => x.slot === v.slot && x.enabled)
  const longMissing = s.tone === 'red'
  const sum = t.kind === 'series' ? seriesFileSummary(t, v.slot) : null
  const only = t.versions.length === 1

  return (
    <div className={cx('rounded-lg border bg-background-100', longMissing ? 'border-red-700/40' : 'border-gray-alpha-400')}>
      {longMissing && (
        <div className="flex items-center gap-2 rounded-t-lg border-b border-red-700/30 bg-red-100 px-4 py-2 text-[13px] text-red-900">
          <TriangleAlert className="size-4" />
          <span className="font-medium">Long missing · since {fmtDate(v.missingSince!)}</span>
          <span className="tabular text-red-900/80">({daysBetween(v.missingSince!, TODAY)} days searchable, nothing matched Profile {p.name})</span>
          <button onClick={() => go('search', { id: t.id, slot: v.slot })} className="ml-auto font-medium underline-offset-2 hover:underline">
            Review Releases
          </button>
        </div>
      )}
      <div className="flex items-start gap-4 p-4">
        <SlotLabel slot={v.slot} />
        <div className="w-52 shrink-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-700">Profile</div>
          <Select
            className="mt-0.5 h-8 w-full text-[13px]"
            value={p.name}
            options={slotProfiles.map((x) => x.name)}
            onChange={(name) => {
              const np = slotProfiles.find((x) => x.name === name)!
              updateVersion(t.id, v.slot, (x) => ({ ...x, profileId: np.id }))
              notify(`${v.slot} Version switched to Profile ${np.name} · rescoring and searching`)
            }}
          />
          <div className="mt-1 text-[11px] text-gray-900">
            {p.requires === 'primary' ? `Requires ${settings.primaryLanguage} audio` : `Requires ${t.originalLanguage} (Original Language)`} · {p.resolution}
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-6 gap-x-5 gap-y-3">
          <Fact label="Status">
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={s.tone} />
              {s.label}
            </span>
            {v.state === 'downloading' && (
              <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-gray-alpha-200">
                <div className="h-full bg-blue-700" style={{ width: `${v.progress}%` }} />
              </div>
            )}
          </Fact>
          <Fact label="Quality">{v.file?.quality ?? sum?.quality ?? <span className="text-gray-700">—</span>}</Fact>
          <Fact label="Languages (probed)">
            {(v.file?.languages ?? sum?.languages)?.join(', ') ?? <span className="text-gray-700">—</span>}
          </Fact>
          <Fact label="Score">
            <span className="tabular font-mono">{v.file ? fmtNum(v.file.score) : sum ? (sum.min === sum.max ? fmtNum(sum.min) : `${fmtNum(sum.min)}–${fmtNum(sum.max)}`) : '—'}</span>
          </Fact>
          <Fact label="Size">{v.file?.size ?? (sum ? `${v.episodesHave} files` : '—')}</Fact>
          <Fact label="Last searched">
            <span className="tabular">{v.lastSearched ?? 'never'}</span>
          </Fact>
          <Fact label="File" className="col-span-6">
            {v.file ? (
              <span className="font-mono text-[12px] text-gray-900" title={v.file.path}>
                {v.file.path}
              </span>
            ) : sum ? (
              <button className="font-mono text-[12px] text-gray-900 hover:text-gray-1000" onClick={() => navigate({ tab: 'files' }, true)}>
                {v.episodesHave} episode files in {t.folder.split('/').pop()} →
              </button>
            ) : (
              <span className="text-gray-700">{v.state === 'unreleased' ? 'Not released yet. Searching starts at the digital release.' : v.state === 'downloading' ? 'Downloading, not imported yet' : 'No file'}</span>
            )}
          </Fact>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            size="sm"
            prefix={<Search className="size-3.5" />}
            disabled={v.state === 'unreleased'}
            onClick={() => {
              updateVersion(t.id, v.slot, (x) => ({ ...x, lastSearched: TODAY }))
              notify(`Searching indexers for the ${v.slot} Version of ${t.title}`)
            }}
          >
            Search
          </Button>
          <Button size="sm" prefix={<ListFilter className="size-3.5" />} onClick={() => go('search', { id: t.id, slot: v.slot })}>
            Manual search
          </Button>
          <Button size="sm" variant="tertiary" className="text-red-900" prefix={<Trash2 className="size-3.5" />} disabled={only} title={only ? 'A Title needs at least one Version' : undefined} onClick={() => setRemoving(true)}>
            Remove Version
          </Button>
        </div>
      </div>
      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Remove the ${v.slot} Version?`}
        footer={
          <>
            <Button size="sm" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="error"
              onClick={() => {
                updateTitle(t.id, (x) => ({ ...x, versions: x.versions.filter((y) => y.slot !== v.slot) }))
                setRemoving(false)
                notify(`${v.slot} Version removed${alsoDelete ? ' and its file deleted' : '; file kept on disk'}`)
              }}
            >
              Remove Version
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-gray-900">
          Kestrel stops searching and upgrading the {v.slot} Version of <span className="text-gray-1000">{t.title}</span> (Profile {p.name}). The other Versions are not touched.
        </p>
        <div className="mt-4 rounded-md border border-gray-alpha-400 bg-background-200 p-3">
          <Checkbox checked={alsoDelete} onChange={setAlsoDelete} label={<span>Also delete file{t.kind === 'series' ? 's' : ''} from disk</span>} />
          {(v.file || sum) && <div className="mt-1.5 truncate pl-6 font-mono text-[11px] text-gray-900">{v.file?.path ?? `${v.episodesHave} episode files tagged [${v.slot}]`}</div>}
        </div>
      </Dialog>
    </div>
  )
}

function EmptySlotRow({ t, slot, highlight }: { t: Title; slot: Slot; highlight: boolean }) {
  const { profiles, updateTitle, notify } = useStore()
  const options = profiles.filter((p) => p.slot === slot && p.enabled)
  const def = options.find((p) => p.defaultFor.includes(t.kind)) ?? options[0]
  const [pid, setPid] = useState(def?.id)
  return (
    <div className={cx('flex items-center gap-4 rounded-lg border border-dashed p-4', highlight ? 'border-blue-700 bg-blue-100' : 'border-gray-alpha-400')}>
      <div className="flex h-9 w-14 items-center justify-center rounded-md border border-dashed border-gray-alpha-400 font-mono text-[13px] font-semibold text-gray-700">{slot}</div>
      <div className="flex-1 text-[13px] text-gray-900">
        No {slot} Version. {slot === 'HD' ? 'HD is the standard Slot.' : `${slot} is opt-in.`}
      </div>
      <Select className="h-8 w-48 text-[13px]" value={options.find((p) => p.id === pid)?.name ?? ''} options={options.map((p) => p.name)} onChange={(n) => setPid(options.find((p) => p.name === n)!.id)} />
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          const v: Version = { slot, profileId: pid!, state: t.status === 'Announced' ? 'unreleased' : 'missing', missingSince: TODAY, lastSearched: TODAY }
          updateTitle(t.id, (x) => ({ ...x, versions: [...x.versions, v].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)) }))
          navigate({ addSlot: null }, true)
          notify(`${slot} Version added with Profile ${options.find((p) => p.id === pid)!.name} · searching`)
        }}
      >
        Add Version
      </Button>
    </div>
  )
}

// ── Episodes ────────────────────────────────────────────────────────────────

function EpisodeCell({ f }: { f: Episode['files'][Slot] }) {
  if (!f) return <span className="text-gray-700">—</span>
  if (f === 'missing')
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-900">
        <Dot tone="amber" /> Missing
      </span>
    )
  if (f === 'downloading')
    return (
      <span className="inline-flex items-center gap-1.5 text-blue-900">
        <Dot tone="blue" /> Downloading
      </span>
    )
  if (f === 'unreleased')
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-900">
        <Dot tone="gray" /> Not aired
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5" title={f.languages.join(', ')}>
      <Dot tone="green" />
      <span>{f.quality}</span>
      <span className="tabular font-mono text-[11px] text-gray-900">{fmtNum(f.score)}</span>
      {f.languages.length < 2 && <Badge tone="amber">{f.languages[0]} only</Badge>}
    </span>
  )
}

function EpisodesTab({ t }: { t: Title }) {
  const { updateTitle } = useStore()
  const seasons = t.seasons ?? []
  const [open, setOpen] = useState<number[]>(() => (seasons.length ? [seasons[seasons.length - 1].number] : []))
  const slots = t.versions.map((v) => v.slot)
  const setSeason = (n: number, fn: (s: NonNullable<Title['seasons']>[number]) => NonNullable<Title['seasons']>[number]) =>
    updateTitle(t.id, (x) => ({ ...x, seasons: x.seasons!.map((s) => (s.number === n ? fn(s) : s)) }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[13px] text-gray-900">
        <span>
          Monitoring: <span className="text-gray-1000">{t.monitoring}</span>
          {t.monitoring === 'Future only' && ' · episodes that aired before the Series was added are not searched'}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setOpen(seasons.map((s) => s.number))}>
            Expand all
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setOpen([])}>
            Collapse all
          </Button>
        </div>
      </div>
      {seasons.map((s) => {
        const isOpen = open.includes(s.number)
        return (
          <div key={s.number} className="rounded-lg border border-gray-alpha-400 bg-background-100">
            <div className="flex h-12 items-center gap-3 px-4">
              <button onClick={() => setOpen(isOpen ? open.filter((n) => n !== s.number) : [...open, s.number])} className="flex flex-1 items-center gap-2 text-left">
                {isOpen ? <ChevronDown className="size-4 text-gray-900" /> : <ChevronRight className="size-4 text-gray-900" />}
                <span className="font-semibold tracking-tight">Season {s.number}</span>
                <span className="tabular text-[13px] text-gray-900">{s.episodes.length} episodes</span>
                <span className="ml-4 flex gap-3">
                  {slots.map((slot) => {
                    const have = s.episodes.filter((e) => typeof e.files[slot] === 'object').length
                    const aired = s.episodes.filter((e) => e.files[slot] !== 'unreleased').length
                    return (
                      <span key={slot} className="tabular inline-flex items-center gap-1.5 font-mono text-[12px] text-gray-900">
                        <Dot tone={have === aired ? 'green' : 'amber'} />
                        {slot} {have}/{aired}
                      </span>
                    )
                  })}
                </span>
              </button>
              <Toggle
                on={s.monitored}
                onChange={(on) => setSeason(s.number, (x) => ({ ...x, monitored: on, episodes: x.episodes.map((e) => ({ ...e, monitored: on })) }))}
                label={<span className="text-[13px] text-gray-900">Monitored</span>}
              />
            </div>
            {isOpen && (
              <table className="w-full border-t border-gray-alpha-400 text-[13px]">
                <thead className="bg-background-200">
                  <tr className="border-b border-gray-alpha-400">
                    <th className={cx(th, 'w-16')}>Mon.</th>
                    <th className={cx(th, 'w-20')}>#</th>
                    <th className={th}>Title</th>
                    <th className={cx(th, 'w-32')}>Air date</th>
                    {slots.map((slot) => (
                      <th key={slot} className={cx(th, 'w-64 font-mono')}>
                        {slot}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.episodes.map((e) => (
                    <tr key={e.number} className={cx('border-b border-gray-alpha-400 last:border-0 hover:bg-gray-alpha-100', !e.monitored && 'opacity-50')}>
                      <td className={td}>
                        <Toggle on={e.monitored} onChange={(on) => setSeason(s.number, (x) => ({ ...x, episodes: x.episodes.map((y) => (y.number === e.number ? { ...y, monitored: on } : y)) }))} />
                      </td>
                      <td className={cx(td, 'font-mono text-[12px] text-gray-900')}>
                        S{String(s.number).padStart(2, '0')}E{String(e.number).padStart(2, '0')}
                      </td>
                      <td className={td}>{e.title}</td>
                      <td className={cx(td, 'tabular text-gray-900')}>{e.airDate}</td>
                      {slots.map((slot) => (
                        <td key={slot} className={td}>
                          <EpisodeCell f={e.files[slot]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Files ───────────────────────────────────────────────────────────────────

const epSize: Record<Slot, string> = { SD: '0.4 GB', HD: '1.6 GB', UHD: '4.9 GB' }

function FilesTab({ t }: { t: Title }) {
  type Row = { slot: Slot; ep?: string; path: string; quality: string; size: string; languages: string[]; score: number }
  const rows: Row[] =
    t.kind === 'movie'
      ? t.versions.filter((v) => v.file).map((v) => ({ slot: v.slot, path: v.file!.path, quality: v.file!.quality, size: v.file!.size, languages: v.file!.languages, score: v.file!.score }))
      : (t.seasons ?? []).flatMap((s) =>
          s.episodes.flatMap((e) =>
            SLOTS.flatMap((slot) => {
              const f = e.files[slot]
              if (typeof f !== 'object') return []
              const code = `S${String(s.number).padStart(2, '0')}E${String(e.number).padStart(2, '0')}`
              const lang = f.languages.length > 1 ? 'German DL' : f.languages[0]
              return [{ slot, ep: code, path: `${t.title} (${t.year}) {tvdb-${t.tvdbId}} - ${code} - ${e.title} [${slot}][${f.quality}][${lang}].mkv`, quality: f.quality, size: epSize[slot], languages: f.languages, score: f.score }]
            }),
          ),
        )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] text-gray-900">
        <FolderOpen className="size-4" />
        <span className="font-mono text-[12px] text-gray-1000">{t.folder}</span>
        <span>· All Versions live side by side in this folder, told apart by the Slot label in the file name.</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No files yet.</Empty>
      ) : (
        <Table
          head={
            <>
              <th className={cx(th, 'w-16')}>Slot</th>
              {t.kind === 'series' && <th className={cx(th, 'w-20')}>Episode</th>}
              <th className={th}>File</th>
              <th className={th}>Quality</th>
              <th className={th}>Languages</th>
              <th className={cx(th, 'text-right')}>Score</th>
              <th className={cx(th, 'text-right')}>Size</th>
            </>
          }
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-alpha-100">
              <td className={cx(td, 'font-mono text-[12px] font-medium')}>{r.slot}</td>
              {t.kind === 'series' && <td className={cx(td, 'font-mono text-[12px] text-gray-900')}>{r.ep}</td>}
              <td className={cx(td, 'max-w-[520px]')}>
                <div className="truncate font-mono text-[12px]" title={r.path}>
                  {r.path}
                </div>
              </td>
              <td className={cx(td, 'whitespace-nowrap')}>{r.quality}</td>
              <td className={cx(td, 'whitespace-nowrap text-gray-900')}>{r.languages.join(', ')}</td>
              <td className={cx(td, 'tabular text-right font-mono text-[12px]')}>{fmtNum(r.score)}</td>
              <td className={cx(td, 'tabular whitespace-nowrap text-right text-gray-900')}>{r.size}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

// ── History ─────────────────────────────────────────────────────────────────

function HistoryTab({ t }: { t: Title }) {
  const rows = history.filter((h) => h.titleId === t.id)
  if (!rows.length) return <Empty>No history for {t.title} yet.</Empty>
  return (
    <Table
      head={
        <>
          <th className={cx(th, 'w-40')}>When</th>
          <th className={th}>Event</th>
          <th className={th}>Slot</th>
          <th className={th}>Release / detail</th>
          <th className={cx(th, 'text-right')}>Score</th>
        </>
      }
    >
      {rows.map((h) => (
        <tr key={h.id} className="hover:bg-gray-alpha-100">
          <td className={cx(td, 'tabular whitespace-nowrap text-gray-900')}>{h.at}</td>
          <td className={td}>
            <Badge tone={eventTone[h.type]}>{h.type}</Badge>
          </td>
          <td className={cx(td, 'font-mono text-[12px]')}>{h.slot ?? '—'}</td>
          <td className={cx(td, 'max-w-[640px]')}>
            {h.release && <div className="truncate font-mono text-[12px]">{h.release}</div>}
            <div className="text-[12px] text-gray-900">{h.detail}</div>
          </td>
          <td className={cx(td, 'tabular text-right font-mono text-[12px]')}>{h.score ? fmtNum(h.score) : '—'}</td>
        </tr>
      ))}
    </Table>
  )
}

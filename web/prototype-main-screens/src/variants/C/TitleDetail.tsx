// PROTOTYPE, throwaway. Variant C Title detail: compact header, Versions strip (SD | HD | UHD), episode heat-map for a Series.
import { useState } from 'react'
import { CircleAlert, Plus, RefreshCw, Search, Trash } from 'lucide-react'
import { go } from '../../nav'
import { SLOTS, TODAY, daysBetween, isLongMissing, type Episode, type Slot, type Title, type Version } from '../../mock'
import { Badge, Button, Poster, Select, cx, fmtNum, versionStatus } from '../../ui'
import { useStore } from './store'
import { Checkbox, MiniToggle, Segmented, ago, fmtDate, sortVersions, span } from './bits'

export function TitleDetail({ t }: { t: Title }) {
  const s = useStore()
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-5 pb-24">
        <Header t={t} />
        <div className="mt-5 grid grid-cols-3 gap-3">
          {SLOTS.map((slot) => {
            const v = t.versions.find((x) => x.slot === slot)
            return v ? <VersionColumn key={slot} t={t} v={v} /> : <EmptyColumn key={slot} t={t} slot={slot} />
          })}
        </div>
        {t.kind === 'series' && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-[13px] font-semibold tracking-tight">Episodes</h2>
              <span className="text-gray-900">Monitor</span>
              <Segmented
                size="xs"
                value={t.monitoring}
                onChange={(m) => {
                  s.updateTitle(t.id, (x) => ({ ...x, monitoring: m }))
                  s.toast(`${t.title}: monitoring ${m}`)
                }}
                options={(['All', 'Future only', 'None'] as const).map((m) => ({ value: m, label: m }))}
              />
            </div>
            <EpisodeMatrix t={t} />
          </div>
        )}
      </div>
    </div>
  )
}

function Header({ t }: { t: Title }) {
  return (
    <div className="flex gap-4">
      <Poster title={t.title} hue={t.hue} small className="w-16" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight">{t.title}</h1>
          <Badge>{t.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
          <Badge tone={t.status === 'Announced' ? 'amber' : t.status === 'Continuing' ? 'blue' : 'gray'}>{t.status}</Badge>
        </div>
        {t.primaryTitle && t.primaryTitle !== t.title && <div className="text-gray-900">{t.primaryTitle}</div>}
        <div className="mt-1 text-gray-900">
          {t.year} · {t.certification} · {t.runtime} · Original Language: {t.originalLanguage}
          {t.genres.length > 0 && ` · ${t.genres.join(', ')}`}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-gray-900">
          <span>tmdb:{t.tmdbId}</span>
          {t.tvdbId && <span>tvdb:{t.tvdbId}</span>}
          <span>{t.imdbId}</span>
          <span className="truncate" title={t.folder}>
            {t.folder}
          </span>
        </div>
        {t.request && (
          <div className="mt-1.5 text-[12px]">
            Requested by <span className="font-medium">{t.request.by}</span> via {t.request.source}
            <span className="text-gray-900">
              {' '}
              · {fmtDate(t.request.at.slice(0, 10))} · {t.request.slots.join(', ')}
            </span>
          </div>
        )}
        {t.releaseDates && (
          <div className="mt-1 text-[12px] text-gray-900">
            {Object.entries(t.releaseDates)
              .map(([k, d]) => `${k[0].toUpperCase()}${k.slice(1)} (DE) ${fmtDate(d!)}`)
              .join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

/** Series Versions don't have one file; summarise their episode files. */
function seriesFiles(t: Title, slot: Slot) {
  const files = (t.seasons ?? []).flatMap((se) => se.episodes.map((e) => e.files[slot])).filter((f): f is { quality: string; score: number; languages: string[] } => typeof f === 'object')
  if (!files.length) return undefined
  const scores = files.map((f) => f.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  return { quality: [...new Set(files.map((f) => f.quality))].join(', '), languages: [...new Set(files.flatMap((f) => f.languages))], score: min === max ? fmtNum(min) : `${fmtNum(min)}–${fmtNum(max)}` }
}

function Field({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-gray-900">{k}</span>
      <span className={cx('min-w-0 truncate text-right', mono && 'font-mono text-[12px] tabular')}>{children}</span>
    </div>
  )
}

function VersionColumn({ t, v }: { t: Title; v: Version }) {
  const s = useStore()
  const [confirm, setConfirm] = useState(false)
  const [alsoDelete, setAlsoDelete] = useState(false)
  const st = versionStatus(v)
  const slotProfiles = s.profiles.filter((p) => p.slot === v.slot && p.enabled)
  const profile = s.profiles.find((p) => p.id === v.profileId)!
  const sf = t.kind === 'series' ? seriesFiles(t, v.slot) : undefined
  const file = v.file ? { quality: v.file.quality, languages: v.file.languages, score: fmtNum(v.file.score) } : sf
  const only = t.versions.length === 1
  const long = isLongMissing(v)

  return (
    <div className={cx('flex flex-col rounded-lg border bg-background-100', long ? 'border-red-700/50' : 'border-gray-alpha-400')}>
      <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-3 py-2">
        <span className="font-mono text-[13px] font-semibold">{v.slot}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-gray-900">Profile</span>
          <Select
            className="h-7! text-[13px]!"
            value={profile.name}
            options={slotProfiles.map((p) => p.name)}
            onChange={(name) => {
              const p = slotProfiles.find((x) => x.name === name)!
              s.updateVersion(t.id, v.slot, (x) => ({ ...x, profileId: p.id }))
              s.toast(`${t.title} · ${v.slot}: Profile switched to ${p.name}`)
            }}
          />
        </div>
        <div className="mb-1 text-[11px] text-gray-900">
          requires {profile.requires === 'primary' ? 'Primary Language (German)' : `Original Language (${t.originalLanguage})`}
        </div>
        {long && (
          <div className="mb-1 flex items-center gap-1.5 rounded-md bg-red-200 px-2 py-1 text-[12px] text-red-900">
            <CircleAlert className="size-3.5 shrink-0" />
            Long missing since {fmtDate(v.missingSince!)} ({span(daysBetween(v.missingSince!, TODAY))})
          </div>
        )}
        {v.state === 'downloading' && (
          <div className="mb-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-alpha-200">
              <div className="h-full bg-blue-700" style={{ width: `${v.progress}%` }} />
            </div>
          </div>
        )}
        {v.state === 'unreleased' ? (
          <div className="py-1 text-gray-900">Not released yet. Kestrel searches once it's out.</div>
        ) : (
          <>
            <Field k="Quality">{file?.quality ?? '—'}</Field>
            <Field k="Languages">{file?.languages.join(', ') ?? '—'}</Field>
            <Field k="Score" mono>
              {file?.score ?? '—'}
            </Field>
            {v.file && (
              <Field k="Size" mono>
                {v.file.size}
              </Field>
            )}
            {v.episodesWanted !== undefined && (
              <Field k="Episodes" mono>
                {v.episodesHave}/{v.episodesWanted}
              </Field>
            )}
          </>
        )}
        <Field k="Last searched">{ago(v.lastSearched)}</Field>
        {v.file && (
          <div className="mt-1 truncate font-mono text-[11px] text-gray-900" title={v.file.path}>
            {v.file.path}
          </div>
        )}
      </div>
      {confirm ? (
        <div className="flex flex-col gap-2 border-t border-gray-alpha-400 bg-background-200 px-3 py-2 rounded-b-lg">
          <div className="text-[12px]">Remove the {v.slot} Version? Kestrel stops looking for it.</div>
          <Checkbox checked={alsoDelete} onChange={setAlsoDelete} label={<span className="text-[12px]">Also delete file</span>} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="tertiary" className="h-7" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="error"
              className="h-7"
              onClick={() => {
                s.updateTitle(t.id, (x) => ({ ...x, versions: x.versions.filter((y) => y.slot !== v.slot) }))
                s.toast(`${v.slot} Version removed${alsoDelete ? ' and its file deleted' : '; file kept on disk'}`)
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 border-t border-gray-alpha-400 px-2 py-1.5">
          <Button
            size="sm"
            variant="tertiary"
            className="h-7 px-2"
            disabled={v.state === 'unreleased'}
            prefix={<RefreshCw className="size-3.5" />}
            onClick={() => {
              s.updateVersion(t.id, v.slot, (x) => ({ ...x, lastSearched: TODAY }))
              s.toast(`Searching ${t.title} · ${v.slot}…`)
            }}
          >
            Search
          </Button>
          <Button size="sm" variant="tertiary" className="h-7 px-2" disabled={v.state === 'unreleased'} prefix={<Search className="size-3.5" />} onClick={() => go('search', { id: t.id, slot: v.slot })}>
            Manual
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            className="ml-auto h-7 px-2 text-red-900"
            disabled={only}
            title={only ? 'A Title keeps at least one Version' : `Remove the ${v.slot} Version`}
            onClick={() => setConfirm(true)}
          >
            <Trash className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function EmptyColumn({ t, slot }: { t: Title; slot: Slot }) {
  const s = useStore()
  const slotProfiles = s.profiles.filter((p) => p.slot === slot && p.enabled)
  const [pid, setPid] = useState(slotProfiles[0]?.id)
  const wanted = (t.seasons ?? []).flatMap((se) => se.episodes).filter((e) => e.monitored && e.airDate <= TODAY).length
  return (
    <div className="flex flex-col rounded-lg border border-dashed border-gray-500 px-3 py-2">
      <div className="flex items-center gap-2 py-0.5">
        <span className="font-mono text-[13px] font-semibold text-gray-900">{slot}</span>
        <span className="text-gray-900">No Version</span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-900">Profile</span>
          <Select className="h-7! text-[13px]!" value={s.profiles.find((p) => p.id === pid)?.name ?? ''} options={slotProfiles.map((p) => p.name)} onChange={(n) => setPid(slotProfiles.find((p) => p.name === n)!.id)} />
        </div>
        <Button
          size="sm"
          prefix={<Plus className="size-3.5" />}
          onClick={() => {
            s.updateTitle(t.id, (x) => ({
              ...x,
              versions: [...x.versions, { slot, profileId: pid!, state: 'missing', missingSince: TODAY, lastSearched: TODAY, ...(t.kind === 'series' ? { episodesHave: 0, episodesWanted: wanted } : {}) }],
            }))
            s.toast(`${slot} Version added to ${t.title} · searching`)
          }}
        >
          Add Version
        </Button>
      </div>
    </div>
  )
}

type Cell = 'available' | 'missing' | 'downloading' | 'unreleased' | 'unmonitored'
const cellClass: Record<Cell, string> = {
  available: 'bg-green-700',
  missing: 'bg-red-700',
  downloading: 'bg-blue-700 animate-pulse',
  unreleased: 'border border-dashed border-gray-600',
  unmonitored: 'bg-gray-400',
}
const cellLabel: Record<Cell, string> = { available: 'Available', missing: 'Missing', downloading: 'Downloading', unreleased: 'Not aired yet', unmonitored: 'Unmonitored' }

function cellOf(e: Episode, slot: Slot, seasonOn: boolean): { c: Cell; detail: string } {
  const f = e.files[slot]
  const fileText = typeof f === 'object' ? `${f.quality} · ${fmtNum(f.score)} · ${f.languages.join(', ')}` : ''
  if (!seasonOn || !e.monitored) return { c: 'unmonitored', detail: fileText ? `Unmonitored · has ${fileText}` : 'Unmonitored' }
  if (typeof f === 'object') return { c: 'available', detail: fileText }
  if (f) return { c: f, detail: cellLabel[f] }
  return e.airDate > TODAY ? { c: 'unreleased', detail: 'Not aired yet' } : { c: 'missing', detail: `Missing since ${fmtDate(e.airDate)}` }
}

function EpisodeMatrix({ t }: { t: Title }) {
  const s = useStore()
  const vs = sortVersions(t.versions)
  const [hover, setHover] = useState<string | null>(null)
  const cols = `3rem minmax(0,1fr) 6.5rem 2.5rem repeat(${vs.length}, 3rem)`
  const setSeason = (n: number, on: boolean) => s.updateTitle(t.id, (x) => ({ ...x, seasons: x.seasons!.map((se) => (se.number === n ? { ...se, monitored: on } : se)) }))
  const setEp = (sn: number, en: number, on: boolean) =>
    s.updateTitle(t.id, (x) => ({ ...x, seasons: x.seasons!.map((se) => (se.number === sn ? { ...se, episodes: se.episodes.map((e) => (e.number === en ? { ...e, monitored: on } : e)) } : se)) }))

  return (
    <div className="overflow-hidden rounded-lg border border-gray-alpha-400">
      <div className="flex h-8 items-center gap-4 border-b border-gray-alpha-400 bg-background-200 px-3 text-[11px] text-gray-900">
        {(Object.keys(cellLabel) as Cell[]).map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cx('size-2.5 rounded-[3px]', cellClass[c].replace('animate-pulse', ''))} />
            {cellLabel[c]}
          </span>
        ))}
        <span className="ml-auto truncate font-mono text-gray-1000">{hover ?? 'Hover a cell for detail'}</span>
      </div>
      <div className="grid items-center gap-x-2 border-b border-gray-alpha-400 px-3 py-1 text-[11px] font-medium text-gray-900" style={{ gridTemplateColumns: cols }}>
        <span>#</span>
        <span>Episode</span>
        <span>Aired</span>
        <span>Mon.</span>
        {vs.map((v) => (
          <span key={v.slot} className="text-center font-mono">
            {v.slot}
          </span>
        ))}
      </div>
      {(t.seasons ?? []).map((se) => {
        const counts = vs.map((v) => se.episodes.filter((e) => typeof e.files[v.slot] === 'object').length)
        return (
          <div key={se.number}>
            <div className="grid items-center gap-x-2 border-b border-gray-alpha-400 bg-background-200 px-3 py-1.5" style={{ gridTemplateColumns: cols }}>
              <span className="font-mono text-[12px] font-semibold">S{String(se.number).padStart(2, '0')}</span>
              <span className="font-medium">
                Season {se.number} <span className="font-normal text-gray-900">· {se.episodes.length} episodes</span>
              </span>
              <span />
              <MiniToggle on={se.monitored} onChange={(on) => setSeason(se.number, on)} title={se.monitored ? 'Season monitored' : 'Season unmonitored'} />
              {counts.map((c, i) => (
                <span key={i} className="text-center font-mono text-[11px] text-gray-900 tabular">
                  {c}/{se.episodes.length}
                </span>
              ))}
            </div>
            {se.episodes.map((e) => (
              <div key={e.number} className={cx('grid h-7 items-center gap-x-2 px-3 hover:bg-gray-alpha-100', !(se.monitored && e.monitored) && 'text-gray-900')} style={{ gridTemplateColumns: cols }}>
                <span className="font-mono text-[12px] text-gray-900">E{String(e.number).padStart(2, '0')}</span>
                <span className="truncate">{e.title}</span>
                <span className="font-mono text-[12px] text-gray-900 tabular">{e.airDate}</span>
                <MiniToggle on={e.monitored} onChange={(on) => setEp(se.number, e.number, on)} title={e.monitored ? 'Episode monitored' : 'Episode unmonitored'} />
                {vs.map((v) => {
                  const { c, detail } = cellOf(e, v.slot, se.monitored)
                  const text = `S${String(se.number).padStart(2, '0')}E${String(e.number).padStart(2, '0')} · ${v.slot} · ${detail}`
                  return (
                    <span key={v.slot} className="flex justify-center" onMouseEnter={() => setHover(text)} onMouseLeave={() => setHover(null)} title={text}>
                      <span className={cx('size-3.5 rounded-[3px]', cellClass[c])} />
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

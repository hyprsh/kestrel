// PROTOTYPE, throwaway. Variant B · Posters: Title detail as a right-side sheet over the dimmed grid.
import { useState } from 'react'
import { ChevronRight, Ellipsis, ExternalLink, Folder, Inbox, Plus, RefreshCw, Search, SlidersHorizontal, Trash, TriangleAlert } from 'lucide-react'
import { go, navigate } from '../../nav'
import { PRIMARY_LANGUAGE, TODAY, daysBetween, isLongMissing, profileById, profiles, SLOTS, type Episode, type Slot, type Title, type Version } from '../../mock'
import { Badge, Kbd, Poster, Toggle, cx, fmtNum, versionStatus, type Tone } from '../../ui'
import { Button, Checkbox, CloseButton, Dialog, IdSelect, Menu, MenuItem, ProgressBar, SectionTitle, Segmented, Sheet, SlotPill, fmtDate, relDays, updateVersion, useStore } from './common'

export const slotProfiles = (slot: Slot) => profiles.filter((p) => p.slot === slot && p.enabled).map((p) => ({ id: p.id, label: p.name }))
const isKidsRated = (cert: string) => /FSK (0|6)$/.test(cert)
export function defaultProfileFor(slot: Slot, cert: string) {
  if (slot === 'HD' && isKidsRated(cert)) return 'kids'
  return profiles.find((p) => p.slot === slot && p.enabled && p.requires === 'primary' && !p.kids)!.id
}

export function TitleSheet({ id }: { id: string }) {
  const { titles } = useStore()
  const t = titles.find((x) => x.id === id)
  const close = () => go('library')
  return (
    <Sheet onClose={close} width={720} label="Title detail">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-alpha-400 px-4">
        <div className="flex items-center gap-1 text-[13px] text-gray-900">
          <button onClick={close} className="hover:text-gray-1000">Library</button>
          <ChevronRight size={14} className="text-gray-600" />
          <span className="text-gray-1000">{t ? (t.kind === 'movie' ? 'Movie' : 'Series') : 'Not found'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Kbd>Esc</Kbd>
          <CloseButton onClick={close} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{t ? <TitleBody t={t} /> : <p className="p-6 text-sm text-gray-900">No Title with id “{id}”.</p>}</div>
    </Sheet>
  )
}

function TitleBody({ t }: { t: Title }) {
  const { toast, update } = useStore()
  const searchAll = () => {
    update(t.id, (x) => ({ ...x, versions: x.versions.map((v) => ({ ...v, lastSearched: TODAY })) }))
    toast(`Searching ${t.versions.length} Versions of ${t.title}…`)
  }
  return (
    <div className="space-y-10 p-6">
      <Hero t={t} onSearchAll={searchAll} />
      <section>
        <SectionTitle sub="One Version per Slot. Each one is filled and upgraded on its own, under its own Profile.">Versions</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          {SLOTS.map((slot) => {
            const v = t.versions.find((x) => x.slot === slot)
            return v ? <VersionCard key={slot} t={t} v={v} /> : <EmptySlotCard key={slot} t={t} slot={slot} />
          })}
        </div>
      </section>
      {t.kind === 'series' && <Seasons t={t} />}
    </div>
  )
}

function Hero({ t, onSearchAll }: { t: Title; onSearchAll: () => void }) {
  const ids = [
    { label: 'TMDB', value: String(t.tmdbId), href: `https://www.themoviedb.org/${t.kind === 'movie' ? 'movie' : 'tv'}/${t.tmdbId}` },
    ...(t.tvdbId ? [{ label: 'TVDB', value: String(t.tvdbId), href: `https://thetvdb.com/dereferrer/series/${t.tvdbId}` }] : []),
    { label: 'IMDb', value: t.imdbId, href: `https://www.imdb.com/title/${t.imdbId}` },
  ]
  const facts = [String(t.year), t.certification, t.runtime !== '—' ? t.runtime : null, `Original Language: ${t.originalLanguage}`].filter(Boolean)
  return (
    <div className="flex gap-6">
      <Poster title={t.title} hue={t.hue} className="w-40 shadow-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[28px] leading-tight font-semibold tracking-tight">{t.title}</h2>
            {t.primaryTitle && t.primaryTitle !== t.title && <div className="mt-0.5 text-[15px] text-gray-900">{t.primaryTitle} <span className="text-[12px] text-gray-700">· {PRIMARY_LANGUAGE} title</span></div>}
          </div>
          <Badge tone={t.status === 'Announced' ? 'gray' : t.status === 'Continuing' ? 'blue' : 'green'}>{t.status}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-900">
          {facts.map((f, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-600">·</span>}
              <span className="tabular">{f}</span>
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.genres.map((g) => <Badge key={g}>{g}</Badge>)}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-gray-900">{t.overview}</p>

        {t.request && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-gray-alpha-400 bg-background-200 px-3 py-2 text-[13px]">
            <Inbox size={15} className="text-purple-900" />
            <span>
              Requested by <span className="font-medium">{t.request.by}</span> via <span className="font-medium">{t.request.source}</span>
            </span>
            <span className="text-gray-900">· {t.request.slots.join(', ')} · {fmtDate(t.request.at)}</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          {ids.map((i) => (
            <a key={i.label} href={i.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-gray-900 hover:text-gray-1000 hover:underline">
              <span className="text-gray-700">{i.label}</span> {i.value}
              <ExternalLink size={11} />
            </a>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[12px] break-all text-gray-900">
          <Folder size={13} className="shrink-0" /> {t.folder}
        </div>
        {t.releaseDates && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-900">
            <span className="text-gray-700">Release dates (DE)</span>
            {Object.entries(t.releaseDates).map(([k, v]) => (
              <span key={k} className="tabular">
                <span className="capitalize">{k}</span> {fmtDate(v!)}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button size="sm" prefix={<Search size={14} />} onClick={onSearchAll}>Search all Versions</Button>
          {t.nextAiring && <span className="self-center text-[12px] text-gray-900">Next episode {fmtDate(t.nextAiring)} ({relDays(t.nextAiring)})</span>}
        </div>
      </div>
    </div>
  )
}

// ── Version cards ───────────────────────────────────────────────────────────

function seriesSample(t: Title, slot: Slot) {
  for (const s of [...(t.seasons ?? [])].reverse())
    for (const e of [...s.episodes].reverse()) {
      const f = e.files[slot]
      if (f && typeof f === 'object') return f
    }
}

function VersionCard({ t, v }: { t: Title; v: Version }) {
  const { update, toast } = useStore()
  const [confirm, setConfirm] = useState(false)
  const s = versionStatus(v)
  const p = profileById(v.profileId)
  const sample = v.file ?? seriesSample(t, v.slot)
  const longMissing = isLongMissing(v)
  const onlyVersion = t.versions.length === 1

  const search = () => {
    update(t.id, (x) => updateVersion(x, v.slot, (y) => ({ ...y, lastSearched: TODAY })))
    toast(`Searching for the ${v.slot} Version of ${t.title}…`)
  }
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-gray-alpha-400 bg-background-100">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <span className="font-mono text-lg font-semibold tracking-tight">{v.slot}</span>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div>
          <IdSelect
            className="w-full"
            value={v.profileId}
            options={slotProfiles(v.slot)}
            onChange={(pid) => {
              update(t.id, (x) => updateVersion(x, v.slot, (y) => ({ ...y, profileId: pid })))
              toast(`${v.slot} Version switched to Profile ${profileById(pid).name}`)
            }}
          />
          <div className="mt-1 text-[11px] text-gray-900">Requires {p.requires === 'primary' ? PRIMARY_LANGUAGE : `Original Language (${t.originalLanguage})`} audio</div>
        </div>

        {v.state === 'downloading' && (
          <div>
            <div className="mb-1 flex justify-between text-[12px] text-gray-900"><span>Downloading</span><span className="tabular">{v.progress}%</span></div>
            <ProgressBar value={v.progress ?? 0} />
          </div>
        )}

        {sample ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="text-gray-900">Quality</dt>
            <dd className="truncate text-right">{sample.quality}</dd>
            <dt className="text-gray-900">Score</dt>
            <dd className="tabular text-right font-mono font-medium">{fmtNum(sample.score)}</dd>
            {v.file && (
              <>
                <dt className="text-gray-900">Size</dt>
                <dd className="tabular text-right">{v.file.size}</dd>
              </>
            )}
            {v.episodesWanted !== undefined && (
              <>
                <dt className="text-gray-900">Episodes</dt>
                <dd className="tabular text-right">{v.episodesHave} / {v.episodesWanted}</dd>
              </>
            )}
            <dt className="text-gray-900">Audio</dt>
            <dd className="flex flex-wrap justify-end gap-1">
              {sample.languages.map((l) => <span key={l} className="rounded bg-gray-alpha-100 px-1 text-[11px]">{l}</span>)}
            </dd>
          </dl>
        ) : (
          v.state !== 'downloading' && (
            <p className="text-[12px] text-gray-900">
              {v.state === 'unreleased' ? 'Not released yet. Searching starts on the digital release date.' : v.episodesWanted !== undefined ? `${v.episodesHave} of ${v.episodesWanted} episodes on disk.` : 'No file yet.'}
            </p>
          )
        )}

        {v.file && <div title={v.file.path} className="truncate font-mono text-[11px] text-gray-900">{v.file.path}</div>}

        {longMissing && v.missingSince && (
          <div className="flex gap-1.5 rounded-md bg-red-200 px-2 py-1.5 text-[12px] text-red-900">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            <span>Long missing since {fmtDate(v.missingSince)} <span className="tabular opacity-80">({daysBetween(v.missingSince, TODAY)} days)</span></span>
          </div>
        )}
        {!longMissing && v.state === 'missing' && v.missingSince && (
          <div className="rounded-md bg-amber-200 px-2 py-1.5 text-[12px] text-amber-900">Missing since {fmtDate(v.missingSince)}</div>
        )}

        <div className="mt-auto text-[11px] text-gray-900">{v.lastSearched ? <>Last searched {relDays(v.lastSearched)}</> : 'Never searched'}</div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-gray-alpha-400 p-2">
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" prefix={<Search size={13} />} onClick={search} disabled={v.state === 'unreleased'}>Search</Button>
          <Menu
            trigger={(toggle) => (
              <Button size="sm" className="w-8 px-0" onClick={toggle} aria-label={`More actions for the ${v.slot} Version`}>
                <Ellipsis size={15} />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<RefreshCw size={14} />} onClick={() => (close(), search())}>Search now</MenuItem>
                <MenuItem
                  icon={<Trash size={14} />}
                  danger
                  disabled={onlyVersion}
                  hint={onlyVersion ? 'A Title keeps at least one Version' : undefined}
                  onClick={() => (close(), setConfirm(true))}
                >
                  Remove Version
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
        <Button size="sm" prefix={<SlidersHorizontal size={13} />} onClick={() => navigate({ screen: 'search', slot: v.slot })} disabled={v.state === 'unreleased'}>
          Manual search
        </Button>
      </div>
      {confirm && <RemoveVersionDialog t={t} v={v} onClose={() => setConfirm(false)} />}
    </div>
  )
}

function RemoveVersionDialog({ t, v, onClose }: { t: Title; v: Version; onClose: () => void }) {
  const { update, toast } = useStore()
  const [deleteFile, setDeleteFile] = useState(false)
  return (
    <Dialog onClose={onClose} width={460} z={70} label="Remove Version">
      <div className="p-6">
        <h3 className="text-lg font-semibold tracking-tight">Remove the {v.slot} Version?</h3>
        <p className="mt-2 text-sm text-gray-900">
          Kestrel stops searching and upgrading the {v.slot} Version of <span className="text-gray-1000">{t.title}</span>. The other Versions are not touched.
        </p>
        <div className="mt-4 rounded-lg border border-gray-alpha-400 bg-background-200 p-3">
          <Checkbox checked={deleteFile} onChange={setDeleteFile} label="Also delete file" disabled={!v.file && v.episodesHave === undefined} />
          <div className="mt-1.5 pl-6 font-mono text-[11px] break-all text-gray-900">
            {v.file ? v.file.path : v.episodesHave ? `${v.episodesHave} episode files in ${t.folder}` : 'No file on disk'}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-alpha-400 bg-background-200 px-6 py-3">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          variant="error"
          onClick={() => {
            update(t.id, (x) => ({ ...x, versions: x.versions.filter((y) => y.slot !== v.slot) }))
            toast(deleteFile ? `${v.slot} Version removed and its file deleted` : `${v.slot} Version removed; the file stays on disk`)
            onClose()
          }}
        >
          Remove Version
        </Button>
      </div>
    </Dialog>
  )
}

function EmptySlotCard({ t, slot }: { t: Title; slot: Slot }) {
  const { update, toast } = useStore()
  const [pid, setPid] = useState(() => defaultProfileFor(slot, t.certification))
  const add = () => {
    const v: Version = {
      slot,
      profileId: pid,
      state: t.status === 'Announced' ? 'unreleased' : 'missing',
      missingSince: t.status === 'Announced' ? undefined : TODAY,
      lastSearched: TODAY,
      ...(t.kind === 'series' ? { episodesHave: 0, episodesWanted: Math.max(...t.versions.map((x) => x.episodesWanted ?? 0)) } : {}),
    }
    update(t.id, (x) => ({ ...x, versions: [...x.versions, v].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)) }))
    toast(`${slot} Version added with Profile ${profileById(pid).name} · searching`)
  }
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-500 p-4 text-center">
      <span className="font-mono text-lg font-semibold tracking-tight text-gray-700">{slot}</span>
      <p className="text-[12px] text-gray-900">No {slot} Version. Add one to keep a {slot} copy beside the others.</p>
      <IdSelect className="w-full" value={pid} options={slotProfiles(slot)} onChange={setPid} />
      <Button size="sm" className="w-full" prefix={<Plus size={14} />} onClick={add}>
        Add {slot} Version
      </Button>
    </div>
  )
}

// ── Seasons and episodes ────────────────────────────────────────────────────

function Seasons({ t }: { t: Title }) {
  const { update } = useStore()
  const seasons = t.seasons ?? []
  const [sel, setSel] = useState(seasons[seasons.length - 1]?.number ?? 1)
  const season = seasons.find((s) => s.number === sel)
  const setSeason = (fn: (s: NonNullable<Title['seasons']>[number]) => NonNullable<Title['seasons']>[number]) =>
    update(t.id, (x) => ({ ...x, seasons: x.seasons?.map((s) => (s.number === sel ? fn(s) : s)) }))

  return (
    <section>
      <SectionTitle
        sub={{ All: 'Every episode, past and future, is wanted.', 'Future only': 'Only episodes airing from now on are wanted.', None: 'Nothing is searched for automatically.' }[t.monitoring]}
        right={
          <Segmented
            value={t.monitoring}
            onChange={(m) => update(t.id, (x) => ({ ...x, monitoring: m }))}
            options={(['All', 'Future only', 'None'] as const).map((m) => ({ value: m, label: m }))}
          />
        }
      >
        Monitoring
      </SectionTitle>

      <div className="mt-6 flex items-center justify-between border-b border-gray-alpha-400">
        <div className="-mb-px flex gap-1">
          {seasons.map((s) => (
            <button key={s.number} onClick={() => setSel(s.number)} className={cx('relative h-10 px-3 text-sm', s.number === sel ? 'font-medium text-gray-1000' : 'text-gray-900 hover:text-gray-1000')}>
              S{s.number}
              {!s.monitored && <span className="ml-1 text-[11px] text-gray-700">off</span>}
              {s.number === sel && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gray-1000" />}
            </button>
          ))}
        </div>
        {season && <Toggle on={season.monitored} onChange={(on) => setSeason((s) => ({ ...s, monitored: on }))} label={<span className="text-[13px] text-gray-900">Season monitored</span>} />}
      </div>

      {seasons.length === 0 && <p className="mt-4 text-sm text-gray-900">Seasons and episodes appear after the first metadata refresh from TheTVDB.</p>}
      {season && (
        <div className={cx('mt-4 grid gap-2', !season.monitored && 'opacity-60')}>
          {season.episodes.map((e) => (
            <EpisodeCard
              key={e.number}
              t={t}
              season={season.number}
              e={e}
              onToggle={(on) => setSeason((s) => ({ ...s, episodes: s.episodes.map((x) => (x.number === e.number ? { ...x, monitored: on } : x)) }))}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function episodePill(slot: Slot, f: Episode['files'][Slot]) {
  let tone: Tone = 'gray'
  let label = 'not wanted'
  if (f === 'missing') (tone = 'amber'), (label = 'Missing')
  else if (f === 'downloading') (tone = 'blue'), (label = 'Downloading')
  else if (f === 'unreleased') (tone = 'gray'), (label = 'Not aired yet')
  else if (f) (tone = 'green'), (label = `${f.quality} · ${fmtNum(f.score)} · ${f.languages.join(', ')}`)
  return <SlotPill key={slot} slot={slot} tone={tone} size="sm" title={`${slot} · ${label}`} />
}

function EpisodeCard({ t, season, e, onToggle }: { t: Title; season: number; e: Episode; onToggle: (on: boolean) => void }) {
  const future = e.airDate > TODAY
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-alpha-400 px-3 py-2.5">
      <span className="tabular flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-gray-alpha-100 font-mono text-[12px] font-medium">
        {String(season).padStart(2, '0')}·{String(e.number).padStart(2, '0')}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-sm', !e.monitored && 'text-gray-900')}>{e.title}</div>
        <div className="tabular text-[12px] text-gray-900">
          {fmtDate(e.airDate)}
          {future && <span className="text-blue-900"> · {relDays(e.airDate)}</span>}
        </div>
      </div>
      <div className="flex gap-1">{t.versions.map((v) => episodePill(v.slot, e.files[v.slot]))}</div>
      <Toggle on={e.monitored} onChange={onToggle} />
    </div>
  )
}

// chrome: domain-visual
// What a Movie adds to its Title page: its Versions as an accordion, one row per Slot, all closed to start with. A row is one line
// saying the Slot and its Profile with what it holds, over its file name, a status chip, the size and the row's actions, the same
// open or closed. Opened, a row adds what its state needs: a file's facts, a download's progress, or why nothing was grabbed yet.
import { Button, Progress } from '@hyprsh/design'
import { useEffect, useState } from 'react'
import { useDownloadClient } from '../api/activity'
import type { Profile, TitleDetail } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { ago, span, until, useNow } from '../time'
import { dotState, stateName, type SlotDotState } from '../ui/slotState'
import { size } from './bits'
import { baseName } from './cellDetail'
import { AccordionList, AccordionRow, bodyWrap, Chevron, days, Fact, factsGrid, lastSearchWords, lineRow, phoneRow, RowName, SizeCell } from './accordion'
import { useEpisodeView } from './episodeView'
import { DeleteFile } from './DeleteFiles'
import { importedOn, EndOfPath } from './EpisodeFilePopover'
import { audioFormat, audioLine, qualityLine, qualityName } from './media'
import { AddVersion } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'
import { SlotPills } from './SlotPills'
import { slotsOf, useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { VersionRowActions } from './VersionRows'
import { foundText, whyNoneFit } from './WantedLine'

type Version = TitleDetail['versions'][number]

/** A Slot's state in a line: "Have · BluRay 1080p", "Downloading 40% · 13 min left", "Wanted 12 days · next search in 4 h". */
function stateLine(v: Version, dl: SlotDownloads | null, now: number): { text: string; tone: string; state: SlotDotState | null; chip: string } {
  const state = dl ? 'downloading' : dotState(v.state, v.long_missing)
  if (dl) {
    const text = `Downloading${dl.pct !== null ? ` ${dl.pct}%` : ''}${dl.eta !== null ? ` · ${span(dl.eta * 1000)} left` : ''}`
    return { text, tone: 'text-blue-900', state: 'downloading', chip: `Downloading${dl.pct !== null ? ` ${dl.pct}%` : ''}` }
  }
  if (v.file) return { text: `Have${v.file.quality ? ` · ${qualityName(v.file.quality)}` : ''}`, tone: 'text-gray-900', state: 'filled', chip: 'Imported' }
  if (state === 'wanted' || state === 'long_missing') {
    const d = days(v.wanted_since, now)
    const what = state === 'long_missing' ? 'Long Missing' : 'Wanted'
    const text = `${what}${d >= 1 ? ` ${plural(d, 'day')}` : ''}${v.next_search_at ? ` · next search ${until(v.next_search_at, now)}` : ''}`
    return {
      text,
      tone: state === 'long_missing' ? 'text-red-900' : 'text-amber-900',
      state,
      chip: `${what}${d >= 1 ? ` \u00b7 ${d} d` : ''}`,
    }
  }
  const text = state ? stateName[state] : 'No Version'
  return { text, tone: 'text-gray-900', state, chip: text }
}

export function MovieSection({
  title,
  profiles,
  profileName,
  onManualSearch,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch: (t: ManualSearchTarget) => void
}) {
  const downloads = useTitleDownloads(title.id)
  const now = useNow()
  const slots = useSlotNames()
  const versions = slotsOf(title, slots).flatMap((s) => title.versions.filter((v) => v.slot === s.key))
  const at = useEpisodeView(title.id).slot
  // Open: only the Slot the page was opened at.
  const [open, setOpen] = useState<Set<string>>(() => new Set(at ? [at] : []))
  useEffect(() => {
    if (!at) return
    setOpen((o) => (o.has(at) ? o : new Set(o).add(at)))
    document.getElementById(`version-${at}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at, title.id])
  const [adding, setAdding] = useState(false)
  const free = title.versions.length < slots.list.length // a Slot is left without a Version
  if (versions.length === 0) return null
  const toggle = (slot: string) => setOpen((o) => (o.has(slot) ? new Set([...o].filter((x) => x !== slot)) : new Set(o).add(slot)))
  return (
    <section aria-label="Versions" className="mt-6 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="heading-16 flex-1">Versions</h3>
        {free && (
          <Button variant="tertiary" size="small" onClick={() => setAdding(true)}>
            Add a Slot
          </Button>
        )}
      </div>
      <AccordionList label="Versions">
        {versions.map((v) => (
          <SlotRow
            key={v.id}
            {...{ title, profiles, profileName, onManualSearch }}
            version={v}
            downloads={downloads.slot(v.slot)}
            now={now}
            open={open.has(v.slot)}
            onToggle={() => toggle(v.slot)}
            marked={at === v.slot}
          />
        ))}
      </AccordionList>
      {adding && <AddVersion title={title} profiles={profiles} onClose={() => setAdding(false)} />}
    </section>
  )
}

function SlotRow({
  title,
  profiles,
  profileName,
  onManualSearch,
  version: v,
  downloads,
  now,
  open,
  onToggle,
  marked,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch: (t: ManualSearchTarget) => void
  version: Version
  downloads: SlotDownloads | null
  now: number
  open: boolean
  onToggle: () => void
  marked: boolean
}) {
  const phone = usePhone()
  const slots = useSlotNames()
  const name = slots.name(v.slot)
  const line = stateLine(v, downloads, now)
  const f = v.file
  const grab = downloads?.items[0]
  const total = grab ? downloads!.items.reduce((n, i) => n + i.bytes_total, 0) : 0
  const sizeText = f ? size(f.size) : total > 0 ? size(total) : '\u2014'
  // The header is the same open or closed: name and Profile, then what the Slot holds (the file's quality and audio, or the
  // download or Wanted state) over the file's name (the release being fetched, or the last search), the status chip and the size.
  // The facts below carry the detail.
  const ls = v.last_search
  const summary = f ? [qualityLine(f, false), audioFormat(f)].filter(Boolean).join(' \u00b7 ') : line.text
  const fileName = f ? baseName(f.path) : grab ? grab.release_name : ls ? `Last search ${ago(ls.at, now)} \u00b7 ${foundText(ls)}` : 'No file yet'
  const chip = <SlotPills chips={[{ key: v.slot, short: slots.several ? slots.short(v.slot) : '', state: line.state, text: line.chip, tip: `${name}: ${line.text}` }]} max={1} />
  const [deleting, setDeleting] = useState(false)
  const actions = <VersionRowActions {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads} phone={phone} onDeleteFiles={() => setDeleting(true)} />
  return (
    <AccordionRow
      id={`version-${v.slot}`}
      itemLabel={name}
      label={`${name}: ${line.text}`}
      open={open}
      onToggle={onToggle}
      marked={marked}
      rowClass={phone ? phoneRow : lineRow}
      header={
        <>
          <Chevron open={open} />
          {phone ? (
            <>
              <RowName name={name} tag={profileName(v.profile)} />
              <span className="flex items-center gap-1">
                <SizeCell text={sizeText} />
                {actions}
              </span>
              <span className="col-start-2 col-end-4 mt-1 flex min-w-0 items-center gap-2">
                <span className="label-12-mono pointer-events-none min-w-0 flex-1 truncate">{summary}</span>
                <span className="relative">{chip}</span>
              </span>
              {/* A file or release name is one long word: it is cut. A last-search line is a sentence: it wraps to two lines, so its outcome shows. */}
              <span
                title={f?.path ?? grab?.release_name ?? fileName}
                className={`label-12-mono pointer-events-none col-start-2 col-end-4 mt-1 min-w-0 text-gray-900 ${f || grab ? 'truncate' : 'line-clamp-2'}`}
              >
                {fileName}
              </span>
            </>
          ) : (
            <>
              <span title={f?.path ?? grab?.release_name} className="pointer-events-none flex min-w-0 flex-1 flex-col">
                <RowName name={name} tag={profileName(v.profile)} meta={summary} />
                <span title={f || grab ? undefined : fileName} className="label-12-mono max-w-full truncate text-gray-900">
                  {fileName}
                </span>
              </span>
              <span className="relative flex shrink-0 justify-end">{chip}</span>
              <SizeCell text={sizeText} />
              {actions}
            </>
          )}
        </>
      }
      below={<DeleteFile versionId={v.id} file={v.file} asking={deleting} onClose={() => setDeleting(false)} />}
      body={<SlotBody version={v} downloads={downloads} now={now} />}
    />
  )
}

function SlotBody({ version: v, downloads, now }: { version: Version; downloads: SlotDownloads | null; now: number }) {
  const client = useDownloadClient()
  const slots = useSlotNames()
  const f = v.file
  const wrap = bodyWrap
  const grid = factsGrid
  if (downloads) {
    const g = downloads.items[0]
    const total = downloads.items.reduce((n, i) => n + i.bytes_total, 0)
    const left = downloads.items.reduce((n, i) => n + i.bytes_left, 0)
    const speed = g.bytes_per_second ? `${size(g.bytes_per_second)}/s` : null
    const progress = [
      downloads.pct !== null ? `${downloads.pct}%` : null,
      total > 0 ? `${size(total - left)} of ${size(total)}` : null,
      downloads.eta !== null ? `${span(downloads.eta * 1000)} left` : null,
      speed,
      client?.name ?? null,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div className={wrap}>
        <OriginalOfferNote offer={v.original_offer} />
        <div className="flex flex-col gap-1.5">
          {downloads.pct !== null && <Progress value={downloads.pct} type="success" height={6} aria-label={`${slots.name(v.slot)} download progress`} />}
          <span className="label-13 text-blue-900">{progress}</span>
        </div>
        <div className={grid}>
          <Fact k="Release" wide>
            <span className="font-mono text-[12px]">{g.release_name}</span>
          </Fact>
          <Fact k="From">{`${g.indexer} · ${ago(g.grabbed_at, now)}`}</Fact>
          <Fact k="Why">{g.is_upgrade ? `Upgrade${g.score_delta !== null ? ` · +${g.score_delta} points` : ''}` : `Wanted · Score ${g.score.toLocaleString()}`}</Fact>
          <Fact k="Replaces">{g.is_upgrade && f ? baseName(f.path) : 'nothing'}</Fact>
        </div>
      </div>
    )
  }
  if (f) {
    const audio = audioLine(f)
    const on = importedOn(f.imported_at)
    return (
      <div className={wrap}>
        <OriginalOfferNote offer={v.original_offer} />
        <div className={grid}>
          <Fact k="Quality">{f.quality ? qualityName(f.quality) : '—'}</Fact>
          <Fact k="Video">{[f.video_codec, f.hdr ?? 'SDR'].filter(Boolean).join(' · ') || '—'}</Fact>
          <Fact k="Audio">{audio || '—'}</Fact>
          <Fact k="Custom Format Score">{f.score === null ? '—' : `${f.score > 0 ? '+' : ''}${f.score.toLocaleString()}`}</Fact>
          {(f.custom_formats ?? []).length > 0 && (
            <Fact k="Custom Formats" wide>
              <span className="flex flex-wrap gap-1">
                {(f.custom_formats ?? []).map((c) => (
                  <span key={c.name} className="label-12 rounded-full bg-gray-100 px-2">{`${c.name} ${c.points < 0 ? '\u2212' : '+'}${Math.abs(c.points)}`}</span>
                ))}
              </span>
            </Fact>
          )}
          <Fact k="Size">{size(f.size)}</Fact>
          <Fact k="Imported">{[on, f.release_group ? `from ${f.release_group}` : null].filter(Boolean).join(' · ') || '—'}</Fact>
          <Fact k="Path" wide>
            <EndOfPath path={f.path} className="label-12-mono text-gray-900" />
          </Fact>
        </div>
        {f.misfit && <span className="label-12 text-red-900">No longer fits this Profile</span>}
      </div>
    )
  }
  if (v.state === 'wanted') {
    const ls = v.last_search
    const d = days(v.wanted_since, now)
    return (
      <div className={wrap}>
        <OriginalOfferNote offer={v.original_offer} />
        <div className={grid}>
          <Fact k="Wanted since">{v.wanted_since ? `${importedOn(v.wanted_since)} · ${d >= 1 ? plural(d, 'day') : 'today'}` : 'just now'}</Fact>
          <Fact k="Last search">{ls ? `${ago(ls.at, now)} · ${lastSearchWords(ls)}` : 'not searched yet'}</Fact>
          <Fact k="Why none fit">{(ls && whyNoneFit(ls)) || '—'}</Fact>
          <Fact k="Next search">{v.next_search_at ? until(v.next_search_at, now) : '—'}</Fact>
        </div>
      </div>
    )
  }
  return (
    <div className={wrap}>
      <OriginalOfferNote offer={v.original_offer} />
      <span className="label-13 text-gray-900">
        {v.state === 'unreleased'
          ? 'Not out yet: Kestrel searches the moment it is.'
          : v.state === 'unmonitored'
            ? 'Not monitored: Kestrel searches nothing for it.'
            : stateName[dotState(v.state, false) ?? 'unmonitored']}
      </span>
    </div>
  )
}

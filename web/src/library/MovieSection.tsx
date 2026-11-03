// chrome: domain-visual
// What a Movie adds to its Title page: its Versions as cards, two to a row (one to a row on a phone), one per Slot. A card says the Slot
// with its Profile, what the Version holds (the file's quality and audio, or the download or Wanted state), the file's name (the release
// being fetched, or the last search) in mono, then its main action, the size and the ⋯ menu. An Original Offer is a tag on the card.
import { Button } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { ago, span, until, useNow } from '../time'
import { dotState, stateName, type SlotDotState } from '../ui/slotState'
import { size } from './bits'
import { baseName } from './cellDetail'
import { useEpisodeView } from './episodeView'
import { DeleteFile } from './DeleteFiles'
import { audioFormat, qualityLine, qualityName } from './media'
import { AddVersion } from './ManageVersion'
import { MovieFileDetails } from './MovieFileDetails'
import { slotsOf, useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'
import { useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { OriginalOfferTag } from './VersionCards'
import { VersionActions, type Version } from './VersionActions'
import { foundText } from './WantedLine'

/** Whole days since an instant (0 when there is none). */
const days = (since: string | null, now: number) => (since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000)) : 0)

/** A Slot's state in a line: "Have · BluRay 1080p", "Downloading 40% · 13 min left", "Wanted 12 days · next search in 4 h". */
function stateLine(v: Version, dl: SlotDownloads | null, now: number): { text: string; tone: string; state: SlotDotState | null } {
  const state = dl ? 'downloading' : dotState(v.state, v.long_missing)
  if (dl) {
    const text = `Downloading${dl.pct !== null ? ` ${dl.pct}%` : ''}${dl.eta !== null ? ` · ${span(dl.eta * 1000)} left` : ''}`
    return { text, tone: 'text-blue-900', state: 'downloading' }
  }
  if (v.file) return { text: `Have${v.file.quality ? ` · ${qualityName(v.file.quality)}` : ''}`, tone: '', state: 'filled' }
  if (state === 'wanted' || state === 'long_missing') {
    const d = days(v.wanted_since, now)
    const what = state === 'long_missing' ? 'Long Missing' : 'Wanted'
    const text = `${what}${d >= 1 ? ` ${plural(d, 'day')}` : ''}${v.next_search_at ? ` · next search ${until(v.next_search_at, now)}` : ''}`
    return { text, tone: state === 'long_missing' ? 'text-red-900' : 'text-amber-900', state }
  }
  const text = state ? stateName[state] : 'No Version'
  return { text, tone: 'text-gray-900', state }
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
  const cards = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (at) cards.current?.querySelector(`#version-${CSS.escape(at)}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at, title.id])
  const [adding, setAdding] = useState(false)
  const free = title.versions.length < slots.list.length // a Slot is left without a Version
  if (versions.length === 0) return null
  return (
    <section aria-label="Versions" className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="heading-16 flex-1">Versions</h3>
        {free && (
          <Button variant="tertiary" size="small" prefix={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
            Add Version
          </Button>
        )}
      </div>
      <div ref={cards} role="list" aria-label="Versions" className="grid grid-cols-2 items-stretch gap-4 max-sm:grid-cols-1 max-sm:gap-2.5">
        {versions.map((v) => (
          <VersionCard key={v.id} {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads.slot(v.slot)} now={now} marked={at === v.slot} />
        ))}
      </div>
      {adding && <AddVersion title={title} profiles={profiles} onClose={() => setAdding(false)} />}
    </section>
  )
}

function VersionCard({
  title,
  profiles,
  profileName,
  onManualSearch,
  version: v,
  downloads,
  now,
  marked,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch: (t: ManualSearchTarget) => void
  version: Version
  downloads: SlotDownloads | null
  now: number
  marked: boolean
}) {
  const phone = usePhone()
  const slots = useSlotNames()
  const name = slots.name(v.slot)
  const line = stateLine(v, downloads, now)
  const f = v.file
  const grab = downloads?.items[0]
  const total = grab ? downloads!.items.reduce((n, i) => n + i.bytes_total, 0) : 0
  const sizeText = f ? size(f.size) : total > 0 ? size(total) : '—'
  // What the Version holds: the file's quality and audio (else the state), over the file's name (the release being fetched, or the last search).
  const ls = v.last_search
  const summary = f ? [qualityLine(f, false), audioFormat(f)].filter(Boolean).join(' · ') || line.text : line.text
  const fileName = f ? baseName(f.path) : grab ? grab.release_name : ls ? `Last search ${ago(ls.at, now)} · ${foundText(ls)}` : 'No file yet'
  const [deleting, setDeleting] = useState(false)
  const [details, setDetails] = useState(false)
  return (
    <article
      role="listitem"
      aria-label={name}
      id={`version-${v.slot}`}
      data-current={marked ? '' : undefined}
      className={`flex min-w-0 flex-col gap-3 rounded-lg p-4 shadow-border max-sm:gap-2.5 max-sm:p-3.5 ${marked ? 'ring-2 ring-blue-700' : ''}`}
    >
      <span className="flex items-baseline gap-2">
        <span className="heading-16">{name}</span>
        <span className="label-13 min-w-0 flex-1 truncate text-gray-900">{profileName(v.profile)}</span>
        <OriginalOfferTag version={v} />
        {phone && <span className="label-13 text-gray-900 tabular-nums">{sizeText}</span>}
      </span>
      <span className={`label-14 max-sm:label-13 ${line.tone}`}>{summary}</span>
      {!phone && (
        <span title={f?.path ?? grab?.release_name ?? fileName} className={`truncate text-gray-900 ${f || grab ? 'label-12-mono' : 'label-13'}`}>
          {fileName}
        </span>
      )}
      <div className="mt-auto">
        <VersionActions
          {...{ title, profiles, profileName, onManualSearch }}
          version={v}
          downloads={downloads}
          phone={phone}
          onFileDetails={() => setDetails(true)}
          onDeleteFiles={() => setDeleting(true)}
          trailing={phone ? undefined : <span className="label-13 text-gray-900 tabular-nums">{sizeText}</span>}
        />
      </div>
      <DeleteFile versionId={v.id} file={v.file} asking={deleting} onClose={() => setDeleting(false)} />
      {details && f && <MovieFileDetails name={name} file={f} onClose={() => setDetails(false)} />}
    </article>
  )
}

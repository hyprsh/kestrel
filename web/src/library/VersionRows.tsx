// The Versions of a Title on its page. A Series: one compact card per Slot, side by side, with what that Slot is
// downloading inside it. A Movie: one row per Slot in a card, each with its state and its one next action.
import { Button, DotsMenu, Entity, MenuDivider, MenuItem, Note, Progress } from '@hyprsh/design'
import { Download, FileVideo, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import { plural } from '../format'
import { RowList } from '../layout/RowList'
import { ago, span, useNow } from '../time'
import { useReport } from '../toasts'
import { coverageSegments, dotOf, size, slotKeys, slotLabel, versionStatus } from './bits'
import { DeleteFile } from './DeleteFiles'
import { FileDetailsPopover } from './EpisodeFilePopover'
import { IconAction } from './IconAction'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { audioLine, qualityLine } from './media'
import { OriginalOfferNote } from './OriginalOfferNote'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { useSearchVersion } from './VersionSearch'
import { WantedLine } from './WantedLine'

type Version = TitleDetail['versions'][number]

type Props = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

/**
 * The Versions block: one compact card per Slot, side by side, for a Series and a Movie alike. A Slot with no Version
 * is not drawn; the Title menu's Add Version… adds one.
 */
export function VersionRows({ title, profiles, profileName, onManualSearch }: Props) {
  const downloads = useTitleDownloads(title.id)
  const versions = slotKeys.flatMap((k) => title.versions.filter((v) => v.slot === k))
  if (versions.length === 0) return null
  return (
    // One Version fills the row; two or more sit side by side, for a Series and a Movie alike.
    <section aria-label="Versions" className={`my-6 grid grid-cols-1 gap-3 ${versions.length > 1 ? '@2xl:grid-cols-2' : ''}`}>
      {versions.map((v) => (
        <RowList key={v.id} aria-label={slotLabel[v.slot]}>
          <VersionCard {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads.slot(v.slot)} />
        </RowList>
      ))}
    </section>
  )
}

/**
 * A Version's "…" menu and what its items open: Search now, Manual search, Change Profile, Why is it Wanted? while it is Wanted,
 * Cancel download while it downloads, Delete files (a Movie's file) and Remove Version. Nothing here is the Version's one next action; that sits beside it.
 */
function VersionMenu({ title, version: v, profiles, profileName, onManualSearch, downloads, onWhy }: Props & { version: Version; downloads: SlotDownloads | null; onWhy: () => void }) {
  const sw = useSwitchProfile(v.id)
  const report = useReport()
  const rm = useRemoveVersion(v.id)
  const search = useSearchVersion(title, v.id)
  const cancel = useCancelDownloads()
  const [mode, setMode] = useState<'switch' | 'remove' | 'delete' | null>(null)
  const movie = title.kind === 'movie'
  const name = slotLabel[v.slot]
  return (
    <>
      <DotsMenu aria-label={`${name} Version actions`}>
        <MenuItem disabled={unmonitored(title) || search.pending} description={unmonitored(title) ? 'Not monitored: turn monitoring on to search' : undefined} onSelect={search.run}>
          Search now
        </MenuItem>
        <MenuItem onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>Manual search…</MenuItem>
        <MenuItem suffix={<span className="label-12-mono text-gray-900">{profileName(v.profile)}</span>} onSelect={() => setMode('switch')}>
          Change Profile…
        </MenuItem>
        {v.state === 'wanted' && <MenuItem onSelect={onWhy}>Why is it Wanted?</MenuItem>}
        {downloads && (
          <>
            <MenuDivider />
            <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, false)}>
              {downloads.items.length === 1 ? 'Cancel download' : 'Cancel downloads'}
            </MenuItem>
            <MenuItem disabled={cancel.pending} onSelect={() => void cancel.run(downloads.items, true)}>
              Cancel and blocklist
            </MenuItem>
          </>
        )}
        <MenuDivider />
        {movie && (
          <MenuItem type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={() => setMode('delete')}>
            Delete files…
          </MenuItem>
        )}
        <MenuItem type="error" onSelect={() => setMode('remove')}>
          Remove Version…
        </MenuItem>
      </DotsMenu>
      {mode === 'switch' && (
        <ProfilePicker
          profiles={profiles}
          slot={v.slot}
          initial={v.profile}
          label="Change Profile"
          busy={sw.isPending}
          error={sw.error?.message}
          onCancel={() => setMode(null)}
          onPick={(p) => void report(sw.mutateAsync(p), { done: 'Profile switched' }).then((r) => r !== undefined && setMode(null))}
        />
      )}
      {mode === 'remove' && (
        <RemoveConfirm
          what="Version"
          onCancel={() => setMode(null)}
          onConfirm={(d) => {
            setMode(null)
            void report(rm.mutateAsync(d), { done: 'Version removed', failed: 'Could not remove the Version' })
          }}
        />
      )}
      <DeleteFile versionId={v.id} file={v.file} asking={mode === 'delete'} onClose={() => setMode(null)} />
    </>
  )
}

/** One Slot's card: its name, Profile, state and menu on top; below, what the Version holds, what it is downloading, and its offer. */
function VersionCard({ version: v, downloads, ...rest }: Props & { version: Version; downloads: SlotDownloads | null }) {
  const { title } = rest
  const name = slotLabel[v.slot]
  const movie = title.kind === 'movie'
  const [whyOpen, setWhyOpen] = useState(false)
  const wanted = v.state === 'wanted' && !downloads
  return (
    <Entity aria-label={name}>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="label-14-strong">{name}</span>
          <span className="label-13-mono truncate text-gray-900">{rest.profileName(v.profile)}</span>
          <span className="flex-1" />
          {movie ? <MovieStateLabel version={v} downloads={downloads} /> : v.coverage && v.coverage.wanted > 0 && <span className="label-13 text-amber-900">{`${v.coverage.wanted} Wanted`}</span>}
          {movie && <MovieAction {...rest} version={v} downloads={downloads} />}
          <VersionMenu {...rest} version={v} downloads={downloads} onWhy={() => setWhyOpen(true)} />
        </div>
        {movie ? !downloads && <MovieHolds version={v} /> : <SeriesHolds version={v} />}
        {wanted && <VersionWanted {...rest} version={v} open={whyOpen} onOpenChange={setWhyOpen} />}
        {downloads && (
          <Note variant="success" fill size="small" icon={<Download aria-hidden className="size-3.5" />}>
            <span className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate" title={downloads.items[0].release_name}>
                {downloadingWhat(downloads, movie)}
              </span>
              <span className="hy-num shrink-0">{downloadingProgress(downloads)}</span>
            </span>
          </Note>
        )}
        <OriginalOfferNote offer={v.original_offer} />
      </div>
    </Entity>
  )
}

/** The Wanted line of a Version: when it was last searched and what came of it, "Why?", and when the next search is. */
function VersionWanted({ title, version: v, open, onOpenChange, onManualSearch, profileName }: Props & { version: Version; open: boolean; onOpenChange: (open: boolean) => void }) {
  const now = useNow()
  const search = useSearchVersion(title, v.id)
  return (
    <WantedLine
      version={v}
      now={now}
      open={open}
      onOpenChange={onOpenChange}
      searching={search.pending || unmonitored(title)}
      onSearch={search.run}
      onManualSearch={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}
    />
  )
}

/** A Series Version's coverage: a bar and "X of Y episodes", which count every released episode, monitored or not, with the size. */
function SeriesHolds({ version: v }: { version: Version }) {
  const c = v.coverage
  const name = slotLabel[v.slot]
  if (!c) return null
  const released = c.filled + c.wanted + c.unmonitored
  const notMonitored = c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null
  return (
    <>
      <Progress segments={coverageSegments(c)} max={Math.max(released, 1)} height={6} aria-label={`${name}: ${c.filled} of ${released} episodes${notMonitored ? `, ${notMonitored}` : ''}`} />
      <div className="label-13 hy-num flex justify-between gap-3 text-gray-900">
        <span>{`${c.filled} of ${released} episodes${c.long_missing > 0 ? ` · ${c.long_missing} Long Missing` : ''}${notMonitored ? ` · ${notMonitored}` : ''}`}</span>
        {c.size > 0 && <span>{size(c.size)}</span>}
      </div>
    </>
  )
}

/** What a Slot is downloading, in words: its episodes, else its Release, else how many Grabs. */
function downloadingWhat({ items }: SlotDownloads, movie: boolean): string {
  // A Movie's card header already says "Downloading", so its line is just what is downloading.
  const word = movie ? '' : 'Downloading '
  const episodes = items.flatMap((i) => i.episodes)
  if (episodes.length > 0) return `${word}${episodes.length > 3 ? `${episodes.slice(0, 3).join(', ')} and ${episodes.length - 3} more` : episodes.join(', ')}`
  return items.length === 1 ? `${word}${items[0].release_name}` : `${word}${plural(items.length, 'Release')}`.trim()
}

/** "40% · 13 min left", whichever the client knows. */
function downloadingProgress(d: SlotDownloads): string {
  return [d.pct !== null ? `${d.pct}%` : null, d.eta !== null ? `${span(d.eta * 1000)} left` : null].filter(Boolean).join(' · ')
}

const days = (since: string | null, now: number) => (since ? Math.floor((now - new Date(since).getTime()) / 86_400_000) : 0)

/** A Movie Version's state at the right of its card header, where a Series says how many episodes are Wanted. */
function MovieStateLabel({ version: v, downloads }: { version: Version; downloads: SlotDownloads | null }) {
  if (downloads) return <span className="label-13 text-blue-900">Downloading</span>
  if (v.file) return <span className="label-13 text-green-900">Have</span>
  if (v.long_missing || v.state === 'wanted') return <span className="label-13 text-amber-900">{v.long_missing ? 'Long Missing' : 'Wanted'}</span>
  return <span className="label-13 text-gray-900">{v.state === 'unreleased' ? 'Not out yet' : v.state === 'unmonitored' ? 'Not monitored' : versionStatus(v.state).label}</span>
}

/** A Movie Version's one next action, an icon beside the menu: cancel the download, search now, or the file's details. */
function MovieAction({ version: v, downloads, ...rest }: Props & { version: Version; downloads: SlotDownloads | null }) {
  const { title } = rest
  const name = slotLabel[v.slot]
  const search = useSearchVersion(title, v.id)
  const cancel = useCancelDownloads()
  const f = v.file
  if (downloads) return <IconAction icon={X} size="small" label={`Cancel the ${name} download`} disabled={cancel.pending} onClick={() => void cancel.run(downloads.items, false)} />
  if (f)
    return (
      <FileDetailsPopover
        label={`${name} file`}
        heading={name}
        dot={dotOf('filled', false)}
        file={f}
        trigger={
          <Button svgOnly variant="tertiary" size="small" aria-label="File details" title="File details">
            <FileVideo aria-hidden className="size-4" />
          </Button>
        }
      />
    )
  if (v.state === 'wanted') return <IconAction icon={Search} size="small" label={`Search ${name} now`} disabled={unmonitored(title) || search.pending} onClick={search.run} />
  return null
}

/** "3 days ago" once a day has passed, else the live "5 min ago". */
const importedAgo = (iso: string, now: number) => {
  const d = days(iso, now)
  return d >= 1 ? `${plural(d, 'day')} ago` : ago(iso, now)
}

/** What a Movie Version holds: the file's quality, languages and size with when it was imported, or how long it has been Wanted. */
function MovieHolds({ version: v }: { version: Version }) {
  const now = useNow()
  const f = v.file
  if (f) {
    const facts = [qualityLine(f), audioLine(f), size(f.size)].filter(Boolean).join(' · ')
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="label-14 truncate">{facts}</span>
        <span className="label-13 text-gray-900">{`Imported ${importedAgo(f.imported_at, now)}`}</span>
        {f.misfit && <span className="label-12 text-red-900">No longer fits this Profile</span>}
      </div>
    )
  }
  if (v.long_missing || v.state === 'wanted') {
    const d = days(v.wanted_since, now)
    return <span className="label-13 text-gray-900">{d >= 1 ? `${v.long_missing ? 'Long Missing' : 'Wanted'} for ${plural(d, 'day')}` : 'Just became Wanted'}</span>
  }
  return null
}

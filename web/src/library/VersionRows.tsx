// The Versions of a Title on its page. A Series: one compact card per Slot, side by side, with what that Slot is
// downloading inside it. A Movie: one row per Slot in a card, each with its state and its one next action.
import { Button, DotsMenu, Entity, MenuDivider, MenuItem, Note, Progress } from '@hyprsh/design'
import { CircleCheck, CircleDashed, Download, FileVideo, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import { plural } from '../format'
import { RowList, stackedRight, stackedRow } from '../layout/RowList'
import { ago, span, useNow } from '../time'
import { useReport } from '../toasts'
import { coverageSegments, size, slotKeys, slotLabel, versionStatus } from './bits'
import { DeleteFile } from './DeleteFiles'
import { FilePopover } from './EpisodeFilePopover'
import { IconAction } from './IconAction'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { useSearchVersion } from './VersionSearch'

type Version = TitleDetail['versions'][number]

type Props = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

/**
 * The Versions block: a card per Slot for a Series, a row per Slot in one card for a Movie. A Slot with no Version is
 * not drawn; the Title menu's Add Version… adds one.
 */
export function VersionRows({ title, profiles, profileName, onManualSearch }: Props) {
  const downloads = useTitleDownloads(title.id)
  const versions = slotKeys.flatMap((k) => title.versions.filter((v) => v.slot === k))
  if (versions.length === 0) return null
  if (title.kind === 'series') {
    return (
      <section aria-label="Versions" className="my-6 grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {versions.map((v) => (
          <RowList key={v.id} aria-label={slotLabel[v.slot]}>
            <SeriesVersion {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads.slot(v.slot)} />
          </RowList>
        ))}
      </section>
    )
  }
  return (
    <section aria-label="Versions" className="my-6">
      <h3 className="heading-16 mb-2">Versions</h3>
      <RowList aria-label="Versions">
        {versions.map((v) => (
          <MovieVersion key={v.id} {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads.slot(v.slot)} />
        ))}
      </RowList>
    </section>
  )
}

/**
 * A Version's "…" menu and what its items open: Search now, Manual search, Change Profile, Cancel download while it downloads,
 * Delete files (a Movie's file) and Remove Version. Nothing here is the Version's one next action; that sits beside it.
 */
function VersionMenu({ title, version: v, profiles, profileName, onManualSearch, downloads }: Props & { version: Version; downloads: SlotDownloads | null }) {
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

/** "X of Y episodes" counts every released episode, monitored or not. */
function SeriesVersion({ version: v, downloads, ...rest }: Props & { version: Version; downloads: SlotDownloads | null }) {
  const c = v.coverage
  const name = slotLabel[v.slot]
  const released = c ? c.filled + c.wanted + c.unmonitored : 0
  const notMonitored = c && c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null
  return (
    <Entity aria-label={name}>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="label-14-strong">{name}</span>
          <span className="label-13-mono truncate text-gray-900">{rest.profileName(v.profile)}</span>
          <span className="flex-1" />
          {c && c.wanted > 0 && <span className="label-13 text-amber-900">{`${c.wanted} Wanted`}</span>}
          <VersionMenu {...rest} version={v} downloads={downloads} />
        </div>
        {c && (
          <>
            <Progress segments={coverageSegments(c)} max={Math.max(released, 1)} height={6} aria-label={`${name}: ${c.filled} of ${released} episodes${notMonitored ? `, ${notMonitored}` : ''}`} />
            <div className="label-13 hy-num flex justify-between gap-3 text-gray-900">
              <span>{`${c.filled} of ${released} episodes${c.long_missing > 0 ? ` · ${c.long_missing} Long Missing` : ''}${notMonitored ? ` · ${notMonitored}` : ''}`}</span>
              {c.size > 0 && <span>{size(c.size)}</span>}
            </div>
          </>
        )}
        {downloads && (
          <Note variant="success" fill size="small" icon={<Download aria-hidden className="size-3.5" />}>
            <span className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate">{downloadingWhat(downloads)}</span>
              <span className="hy-num shrink-0">{downloadingProgress(downloads)}</span>
            </span>
          </Note>
        )}
        <OriginalOfferNote offer={v.original_offer} />
      </div>
    </Entity>
  )
}

/** What a Slot is downloading, in words: its episodes, else its Release, else how many Grabs. */
function downloadingWhat({ items }: SlotDownloads): string {
  const episodes = items.flatMap((i) => i.episodes)
  if (episodes.length > 0) return `Downloading ${episodes.length > 3 ? `${episodes.slice(0, 3).join(', ')} and ${episodes.length - 3} more` : episodes.join(', ')}`
  return items.length === 1 ? `Downloading ${items[0].release_name}` : `Downloading ${plural(items.length, 'Release')}`
}

/** "40% · 13 min left", whichever the client knows. */
function downloadingProgress(d: SlotDownloads): string {
  return [d.pct !== null ? `${d.pct}%` : null, d.eta !== null ? `${span(d.eta * 1000)} left` : null].filter(Boolean).join(' · ')
}

const days = (since: string | null, now: number) => (since ? Math.floor((now - new Date(since).getTime()) / 86_400_000) : 0)

/** One Movie Version's row: Slot and Profile on the left, its state in the middle, its one next action and the "…" menu on the right. */
function MovieVersion({ version: v, downloads, ...rest }: Props & { version: Version; downloads: SlotDownloads | null }) {
  const { title } = rest
  const name = slotLabel[v.slot]
  const search = useSearchVersion(title, v.id)
  const cancel = useCancelDownloads()
  const f = v.file
  return (
    <>
      <Entity
        aria-label={name}
        className={stackedRow}
        rightClassName={stackedRight}
        left={
          <span className="flex flex-col gap-0.5">
            <span className="label-14-strong">{name}</span>
            <span className="label-12-mono text-gray-900">{rest.profileName(v.profile)}</span>
          </span>
        }
        leftClassName="shrink-0 @xl:w-28"
        right={
          <>
            {downloads ? (
              <IconAction icon={X} size="small" label={`Cancel the ${name} download`} disabled={cancel.pending} onClick={() => void cancel.run(downloads.items, false)} />
            ) : f ? (
              <FilePopover
                label={`${name} file`}
                path={f.path}
                grabbedAs={f.release_name}
                trigger={
                  <Button svgOnly variant="tertiary" size="small" aria-label="File details" title="File details">
                    <FileVideo aria-hidden className="size-4" />
                  </Button>
                }
              />
            ) : v.state === 'wanted' ? (
              <IconAction icon={Search} size="small" label={`Search ${name} now`} disabled={unmonitored(title) || search.pending} onClick={search.run} />
            ) : null}
            <VersionMenu {...rest} version={v} downloads={downloads} />
          </>
        }
      >
        <div className="min-w-0 flex-1">
          <MovieState version={v} downloads={downloads} />
        </div>
      </Entity>
      <OriginalOfferNote offer={v.original_offer} row />
    </>
  )
}

/** "3 days ago" once a day has passed, else the live "5 min ago". */
const importedAgo = (iso: string, now: number) => {
  const d = days(iso, now)
  return d >= 1 ? `${plural(d, 'day')} ago` : ago(iso, now)
}

/** A Movie Version's state: downloading, Wanted, or the file it holds. */
function MovieState({ version: v, downloads }: { version: Version; downloads: SlotDownloads | null }) {
  const now = useNow()
  const name = slotLabel[v.slot]
  if (downloads) {
    const i = downloads.items[0]
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="label-14 flex items-center gap-2 text-blue-900">
          <Download aria-hidden className="size-4 shrink-0" />
          {['Downloading', downloads.pct !== null ? `${downloads.pct}%` : null, downloads.eta !== null ? `${span(downloads.eta * 1000)} left` : null].filter(Boolean).join(' · ')}
        </span>
        {downloads.pct !== null && <Progress value={downloads.pct} type="success" height={6} aria-label={`${name} download progress`} />}
        <span className="label-12-mono truncate text-gray-900" title={i.release_name}>
          {`${i.release_name} · ${size(i.size)}`}
        </span>
      </div>
    )
  }
  const f = v.file
  if (f) {
    const facts = [f.quality, f.languages?.join(', '), size(f.size)].filter(Boolean).join(' · ')
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="label-14 flex items-center gap-2">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-green-900" />
          <span className="truncate">{facts}</span>
        </span>
        <span className="label-13 text-gray-900">{`Imported ${importedAgo(f.imported_at, now)}`}</span>
        {f.misfit && <span className="label-12 text-red-900">No longer fits this Profile</span>}
      </div>
    )
  }
  if (v.long_missing || v.state === 'wanted') {
    const d = days(v.wanted_since, now)
    const label = v.long_missing ? 'Long Missing' : 'Wanted'
    return (
      <span className="label-14 flex items-center gap-2 text-amber-900">
        <CircleDashed aria-hidden className="size-4 shrink-0" />
        {d >= 1 ? `${label} for ${plural(d, 'day')}` : label}
      </span>
    )
  }
  return <span className="label-14 text-gray-900">{v.state === 'unreleased' ? 'Not out yet' : v.state === 'unmonitored' ? 'Not monitored' : versionStatus(v.state).label}</span>
}

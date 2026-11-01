// chrome: domain-visual
// The Versions of a Series on its page: one compact card per Slot, side by side, with what that Slot is downloading inside it.
// A Movie's Versions are the accordion of MovieSection.tsx, which shares VersionMenu with these cards.
import { DotsMenu, Entity, Menu, MenuDivider, MenuItem, Note, Progress } from '@hyprsh/design'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useEpisodeView } from './episodeView'
import type { Profile, TitleDetail } from '../api/queries'
import { useRemoveVersion, useSwitchProfile } from '../api/versions'
import { plural } from '../format'
import { RowList } from '../layout/RowList'
import { span, useNow } from '../time'
import { useReport } from '../toasts'
import { size } from './bits'
import { slotName, slotsOf } from './slots'
import { DeleteFile } from './DeleteFiles'
import { expandCodes, codeRuns } from './cellDetail'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'
import type { ManualSearchTarget } from './TitleDetail'
import { useCancelDownloads, useTitleDownloads, type SlotDownloads } from './TitleDownloads'
import { useSearchVersion } from './VersionSearch'
import { WantedLine } from './WantedLine'

type Version = TitleDetail['versions'][number]

type Props = { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string; onManualSearch: (target: ManualSearchTarget) => void }

const unmonitored = (t: TitleDetail) => (t.kind === 'movie' ? !t.monitored : t.series_monitor === 'none')

/**
 * A Series' Versions block: one compact card per Slot, side by side. A Slot with no Version is not drawn; the Title menu's
 * Add Version… adds one. A Movie's Versions are the accordion of MovieSection.
 */
export function VersionRows({ title, profiles, profileName, onManualSearch }: Props) {
  const downloads = useTitleDownloads(title.id)
  const versions = title.kind === 'series' ? slotsOf(title).flatMap((s) => title.versions.filter((v) => v.slot === s.key)) : []
  // A Title opened at a Slot ("?slot=4k") scrolls to that Version's card and marks it.
  const at = useEpisodeView(title.id).slot
  useEffect(() => {
    if (at) document.getElementById(`version-${at}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at, title.id])
  if (versions.length === 0) return null
  return (
    // One Version fills the row; two or more sit side by side, for a Series and a Movie alike.
    <section aria-label="Versions" className={`my-6 grid grid-cols-1 gap-3 ${versions.length > 1 ? '@2xl:grid-cols-2' : ''}`}>
      {versions.map((v) => (
        <div key={v.id} id={`version-${v.slot}`} data-current={at === v.slot ? '' : undefined} className={at === v.slot ? 'rounded-lg ring-2 ring-blue-700' : undefined}>
          <RowList aria-label={slotName(v.slot)}>
            <VersionCard {...{ title, profiles, profileName, onManualSearch }} version={v} downloads={downloads.slot(v.slot)} />
          </RowList>
        </div>
      ))}
    </section>
  )
}

/**
 * A Version's "…" menu and what its items open: Search now, Manual search, Change Profile, Why is it Wanted? while it is Wanted,
 * Cancel download while it downloads, Delete files (a Movie's file) and Remove Version. Nothing here is the Version's one next action; that sits beside it.
 */
export function VersionMenu({
  title,
  version: v,
  profiles,
  profileName,
  onManualSearch,
  downloads,
  onWhy,
  more,
}: Props & { version: Version; downloads: SlotDownloads | null; onWhy?: () => void; /** Draws the menu's button as "More…" (a Movie's open Slot) instead of the ⋯ icon. */ more?: boolean }) {
  const sw = useSwitchProfile(v.id)
  const report = useReport()
  const rm = useRemoveVersion(v.id)
  const search = useSearchVersion(title, v.id)
  const cancel = useCancelDownloads()
  const [mode, setMode] = useState<'switch' | 'remove' | 'delete' | null>(null)
  const movie = title.kind === 'movie'
  const name = slotName(v.slot)
  const items = (
    <>
      <MenuItem disabled={unmonitored(title) || search.pending} description={unmonitored(title) ? 'Not monitored: turn monitoring on to search' : undefined} onSelect={search.run}>
        Search now
      </MenuItem>
      <MenuItem onSelect={() => onManualSearch({ versionId: v.id, slot: v.slot, profileName: profileName(v.profile) })}>Manual search…</MenuItem>
      <MenuItem suffix={<span className="label-12-mono text-gray-900">{profileName(v.profile)}</span>} onSelect={() => setMode('switch')}>
        Change Profile…
      </MenuItem>
      {v.state === 'wanted' && onWhy && <MenuItem onSelect={onWhy}>Why is it Wanted?</MenuItem>}
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
    </>
  )
  return (
    <>
      {more ? (
        <Menu.Container position="bottom-end">
          <Menu.Button variant="tertiary" size="small" aria-label={`${name} Version actions`}>
            More…
          </Menu.Button>
          <Menu width={260} aria-label={`${name} Version actions`}>
            {items}
          </Menu>
        </Menu.Container>
      ) : (
        <DotsMenu aria-label={`${name} Version actions`}>{items}</DotsMenu>
      )}
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
  const name = slotName(v.slot)
  const [whyOpen, setWhyOpen] = useState(false)
  const wanted = v.state === 'wanted' && !downloads
  return (
    <Entity aria-label={name}>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="label-14-strong">{name}</span>
          <span className="label-13-mono truncate text-gray-900">{rest.profileName(v.profile)}</span>
          <span className="flex-1" />
          {v.coverage && v.coverage.wanted > 0 && <span className="label-13 text-amber-900">{`${v.coverage.wanted} Wanted`}</span>}
          <VersionMenu {...rest} version={v} downloads={downloads} onWhy={() => setWhyOpen(true)} />
        </div>
        <SeriesHolds version={v} />
        {wanted && <VersionWanted {...rest} version={v} open={whyOpen} onOpenChange={setWhyOpen} />}
        {downloads && (
          <Note variant="success" fill size="small" icon={<Download aria-hidden className="size-3.5" />}>
            <span className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate" title={downloads.items[0].release_name}>
                {downloadingWhat(downloads)}
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
  const name = slotName(v.slot)
  if (!c) return null
  const released = c.filled + c.wanted + c.unmonitored
  const notMonitored = c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null
  return (
    <>
      <Progress type="success" value={c.filled} max={Math.max(released, 1)} height={6} aria-label={`${name}: ${c.filled} of ${released} episodes${notMonitored ? `, ${notMonitored}` : ''}`} />
      <div className="label-13 hy-num flex justify-between gap-3 text-gray-900">
        <span>{`${c.filled} of ${released} episodes${c.long_missing > 0 ? ` · ${c.long_missing} Long Missing` : ''}${notMonitored ? ` · ${notMonitored}` : ''}`}</span>
        {c.size > 0 && <span>{size(c.size)}</span>}
      </div>
    </>
  )
}

/** What a Slot is downloading, in words: its episodes as runs ("S05E05–E10"), else its Release, else how many Grabs. */
function downloadingWhat({ items }: SlotDownloads): string {
  const episodes = items.flatMap((i) => expandCodes(i.episodes))
  if (episodes.length > 0) return codeRuns(episodes)
  return items.length === 1 ? `Downloading ${items[0].release_name}` : `Downloading ${plural(items.length, 'Release')}`
}

/** "40% · 13 min left", whichever the client knows. */
function downloadingProgress(d: SlotDownloads): string {
  return [d.pct !== null ? `${d.pct}%` : null, d.eta !== null ? `${span(d.eta * 1000)} left` : null].filter(Boolean).join(' · ')
}

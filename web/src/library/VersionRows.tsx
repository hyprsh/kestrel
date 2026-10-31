// The Versions of a Title on its page: one compact row per Slot, filled or not kept.
import { Button, DotsMenu, Entity, FilterMenu, MenuDivider, MenuItem, Note, Progress } from '@hyprsh/design'
import { useState, type ReactNode } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useAddVersion, useRemoveVersion, useSwitchProfile } from '../api/versions'
import { coverageSegments, size, slotKeys, slotLabel, StatusBadge, versionStatus, type SlotKey } from './bits'
import { DeleteFile } from './DeleteFiles'
import { FilePopover } from './EpisodeFilePopover'
import { useReport } from '../toasts'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'

type Version = TitleDetail['versions'][number]

/**
 * The Versions block: a row per Slot. A row has the Slot, the Profile, the state badge, a bar with what the
 * Version holds (a Series' episode coverage, a Movie's file or state) and a "…" menu with its actions; it stacks
 * on a narrow pane. A Slot with no Version is the same row with an empty bar and Add Version.
 */
export function VersionRows({ title, profiles, profileName }: { title: TitleDetail; profiles: Profile[]; profileName: (key: string) => string }) {
  return (
    <section aria-label="Versions" className="mt-6">
      <h3 className="heading-14 mb-1">Versions</h3>
      <Entity.List aria-label="Versions">
        {slotKeys.map((k) => {
          const v = title.versions.find((x) => x.slot === k)
          return v ? (
            <VersionRow key={k} version={v} kind={title.kind} profiles={profiles} profileName={profileName} />
          ) : (
            <EmptyRow key={k} slot={k} titleId={title.id} kind={title.kind} profiles={profiles} />
          )
        })}
      </Entity.List>
    </section>
  )
}

function VersionRow({ version: v, kind, profiles, profileName }: { version: Version; kind: TitleDetail['kind']; profiles: Profile[]; profileName: (key: string) => string }) {
  const sw = useSwitchProfile(v.id)
  const report = useReport()
  const rm = useRemoveVersion(v.id)
  const [mode, setMode] = useState<'switch' | 'remove' | 'delete' | null>(null)
  const movie = kind === 'movie'
  return (
    <Entity
      aria-label={slotLabel[v.slot]}
      left={<span className="label-12-mono w-14 text-gray-900">{slotLabel[v.slot]}</span>}
      right={
        <DotsMenu aria-label={`More ${slotLabel[v.slot]} Version actions`}>
          <MenuItem onSelect={() => setMode('switch')}>Change Profile</MenuItem>
          <MenuDivider />
          {movie && (
            <MenuItem type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={() => setMode('delete')}>
              Delete file
            </MenuItem>
          )}
          <MenuItem type="error" onSelect={() => setMode('remove')}>
            Remove Version
          </MenuItem>
        </DotsMenu>
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1.5 @xl:flex-row @xl:items-center @xl:gap-4">
          <div className="flex min-w-0 items-center gap-3 @xl:w-56 @xl:shrink-0">
            <span className="label-14 truncate">{profileName(v.profile)}</span>
            <StatusBadge state={v.state} longMissing={v.long_missing} />
          </div>
          <div className="min-w-0 flex-1">
            <Holds version={v} kind={kind} />
            <OriginalOfferNote offer={v.original_offer} />
          </div>
        </div>
        {mode === 'switch' && (
          <ProfilePicker
            profiles={profiles}
            slot={v.slot}
            initial={v.profile}
            label="Switch Profile"
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
      </div>
    </Entity>
  )
}

/**
 * A Slot with no Version: its name, "Not kept" and an Add Version dropdown of the Slot's enabled Profiles,
 * the default of the Title's kind selected. Choosing a Profile, the selected one too, adds the Version.
 */
function EmptyRow({ slot, titleId, kind, profiles }: { slot: SlotKey; titleId: number; kind: TitleDetail['kind']; profiles: Profile[] }) {
  const add = useAddVersion(titleId)
  const options = profiles.filter((p) => p.slot === slot && p.enabled)
  const initial = (options.find((p) => (kind === 'series' ? p.default_series : p.default_movies)) ?? options[0])?.key
  const [choice, setChoice] = useState<string | undefined>(undefined)
  return (
    <Entity
      aria-label={slotLabel[slot]}
      left={<span className="label-12-mono w-14 text-gray-900">{slotLabel[slot]}</span>}
      right={
        options.length > 0 ? (
          <FilterMenu
            single
            label="Add Version"
            size="small"
            align="end"
            disabled={add.isPending}
            value={choice ?? initial}
            items={options.map((p: Profile) => ({ value: p.key, label: p.name }))}
            onChange={(profile: string) => {
              setChoice(profile)
              add.mutate({ slot, profile })
            }}
          />
        ) : undefined
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1.5 @xl:flex-row @xl:items-center @xl:gap-4">
          <span className="label-14 text-gray-900 @xl:w-56 @xl:shrink-0">Not kept</span>
          <div aria-hidden className="w-40 max-w-full">
            <Progress value={0} height={6} aria-label={`${slotLabel[slot]}: not kept`} />
          </div>
        </div>
        {add.error && (
          <div className="mt-2">
            <Note variant="error" size="small">
              {add.error.message}
            </Note>
          </div>
        )}
      </div>
    </Entity>
  )
}

/** The bar of a Version row and the plain text beside it, so the row says how complete the Version is. */
function Held({ bar, text }: { bar: ReactNode; text: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="w-40 max-w-full shrink-0">{bar}</div>
      {text}
    </div>
  )
}

const days = (since: string | null) => (since ? Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000) : 0)

/** A Movie Version's state in words, when it holds no file: "Not out yet", "Wanted for 3 days". */
function movieState(v: Version): string {
  if (v.long_missing || v.state === 'wanted') {
    const d = days(v.wanted_since)
    return d >= 1 ? `${versionStatus(v.state, v.long_missing).label} for ${d} ${d === 1 ? 'day' : 'days'}` : versionStatus(v.state, v.long_missing).label
  }
  if (v.state === 'unreleased') return 'Not out yet'
  if (v.state === 'unmonitored') return 'Not monitored'
  return versionStatus(v.state).label
}

/**
 * What a Version holds, worded so it never contradicts the badge: a Series' episode coverage on a bar (Wanted exactly
 * when episodes are), or a Movie's file by its quality and size (a click shows the path) or its state.
 */
function Holds({ version: v, kind }: { version: Version; kind: TitleDetail['kind'] }) {
  if (kind === 'series') {
    const c = v.coverage
    if (!c) return null
    // "of N" counts every released episode, monitored or not.
    const released = c.filled + c.wanted + c.unmonitored
    const notMonitored = c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null
    const counts = [
      `${c.filled} of ${released}`,
      c.wanted > 0 ? `${c.wanted} Wanted` : null,
      c.long_missing > 0 ? `${c.long_missing} Long Missing` : null,
      notMonitored,
      c.size > 0 ? size(c.size) : null,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <Held
        bar={
          <Progress
            segments={coverageSegments(c)}
            max={Math.max(released, 1)}
            height={6}
            aria-label={`${slotLabel[v.slot]}: ${c.filled} of ${released} episodes${notMonitored ? `, ${notMonitored}` : ''}`}
          />
        }
        text={<span className="label-13 hy-num text-gray-900">{counts}</span>}
      />
    )
  }
  const f = v.file
  if (!f) {
    return (
      <Held
        bar={<Progress value={0} height={6} aria-label={`${slotLabel[v.slot]}: ${versionStatus(v.state, v.long_missing).label}`} />}
        text={<span className="label-13 text-gray-900">{movieState(v)}</span>}
      />
    )
  }
  const facts = [f.quality, f.languages?.join(' + '), size(f.size), f.score !== null ? `Score ${f.score}` : null].filter(Boolean).join(' · ')
  return (
    <>
      <Held
        bar={<Progress segments={[{ value: 1, tone: 'success' }]} max={1} height={6} aria-label={`${slotLabel[v.slot]}: filled`} />}
        text={
          <FilePopover
            label={`${slotLabel[v.slot]} file`}
            path={f.path}
            grabbedAs={f.release_name}
            position="bottom-start"
            trigger={
              <Button variant="tertiary" size="tiny" title={f.path} className="label-13 min-w-0 truncate text-gray-900">
                {facts}
              </Button>
            }
          />
        }
      />
      {f.misfit && <div className="label-12 text-red-900">No longer fits this Profile</div>}
    </>
  )
}

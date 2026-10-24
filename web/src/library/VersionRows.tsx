// The Versions of a Title on its page: one compact row per Slot, filled or not kept.
import { DotsMenu, Entity, FilterMenu, Link, MenuDivider, MenuItem, Note } from '@hyprsh/design'
import { useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useAddVersion, useRemoveVersion, useSwitchProfile } from '../api/versions'
import { size, slotKeys, slotLabel, StatusBadge, type SlotKey } from './bits'
import { base, DeleteFile } from './DeleteFiles'
import { FilePopover } from './EpisodeFilePopover'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'

type Version = TitleDetail['versions'][number]

/**
 * The Versions block: a row per Slot. A row has the Slot, the Profile, the state badge, what the
 * Version holds and a "…" menu with its actions; it stacks on a narrow pane. A Slot with no Version
 * is one quiet row with Add Version.
 */
export function VersionRows({
  title,
  profiles,
  profileName,
  onCoverage,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onCoverage: () => void
}) {
  return (
    <section aria-label="Versions" className="mt-6">
      <h3 className="heading-14 mb-1">Versions</h3>
      <Entity.List aria-label="Versions">
        {slotKeys.map((k) => {
          const v = title.versions.find((x) => x.slot === k)
          return v ? (
            <VersionRow key={k} version={v} kind={title.kind} profiles={profiles} profileName={profileName} onCoverage={onCoverage} />
          ) : (
            <EmptyRow key={k} slot={k} titleId={title.id} kind={title.kind} profiles={profiles} />
          )
        })}
      </Entity.List>
    </section>
  )
}

function VersionRow({
  version: v,
  kind,
  profiles,
  profileName,
  onCoverage,
}: {
  version: Version
  kind: TitleDetail['kind']
  profiles: Profile[]
  profileName: (key: string) => string
  onCoverage: () => void
}) {
  const sw = useSwitchProfile(v.id)
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
        <div className="flex flex-col gap-1 @xl:flex-row @xl:items-center @xl:gap-3">
          <div className="flex min-w-0 items-center gap-3 @xl:w-64 @xl:shrink-0">
            <span className="label-14 truncate">{profileName(v.profile)}</span>
            <StatusBadge state={v.state} longMissing={v.long_missing} />
          </div>
          <div className="min-w-0 flex-1">
            <Holds version={v} kind={kind} onCoverage={onCoverage} />
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
            onPick={(p) => sw.mutate(p, { onSuccess: () => setMode(null) })}
          />
        )}
        {mode === 'remove' && <RemoveConfirm what="Version" busy={rm.isPending} error={rm.error?.message} onCancel={() => setMode(null)} onConfirm={(d) => rm.mutate(d)} />}
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
        <span className="copy-13 text-gray-900">Not kept</span>
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

/**
 * What a Version holds, worded so it never contradicts the badge: a Movie's file by its name on
 * disk (a click shows the path), or a Series' episode coverage (Wanted exactly when episodes are).
 */
function Holds({ version: v, kind, onCoverage }: { version: Version; kind: TitleDetail['kind']; onCoverage: () => void }) {
  if (kind === 'series') {
    const c = v.coverage
    if (!c) return null
    const parts = [
      `${c.filled} of ${c.episodes} episodes`,
      c.size > 0 ? size(c.size) : null,
      c.wanted > 0 ? `${c.wanted} Wanted` : null,
      c.long_missing > 0 ? `${c.long_missing} Long Missing` : null,
    ].filter(Boolean)
    return (
      <Link as="button" title="Show the episodes" onClick={onCoverage} className="label-13 text-left">
        {parts.join(' · ')}
      </Link>
    )
  }
  const f = v.file
  if (!f) return <div className="label-13 text-gray-900">No file yet</div>
  return (
    <div className="min-w-0">
      <FilePopover
        label={`${slotLabel[v.slot]} file`}
        path={f.path}
        grabbedAs={f.release_name}
        position="bottom-start"
        trigger={
          <Link as="button" title={f.path} className="label-13-mono block max-w-full truncate text-left">
            {base(f.path)}
          </Link>
        }
      />
      <div className="label-12 text-gray-900">
        {[f.quality, f.languages?.join(' + '), size(f.size)].filter(Boolean).join(' · ')}
        {f.score !== null && ` · Score ${f.score}`}
      </div>
      {f.misfit && <div className="label-12 text-red-900">No longer fits this Profile</div>}
    </div>
  )
}

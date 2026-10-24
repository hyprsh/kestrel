// chrome: pending
// The Versions of a Title on its page: one compact row per Slot, filled or not kept.
import { FilterMenu, Menu, Note } from '@hyprsh/design'
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useAddVersion, useRemoveVersion, useSwitchProfile } from '../api/versions'
import { size, slotKeys, slotLabel, StatusBadge, type SlotKey } from './bits'
import { base, DeleteFile } from './DeleteFiles'
import { FilePopover } from './EpisodeFilePopover'
import { ProfilePicker, RemoveConfirm } from './ManageVersion'
import { OriginalOfferNote } from './OriginalOfferNote'

type Version = TitleDetail['versions'][number]

/** Narrow: Slot, Profile and badge, the "…" menu, then what it holds under them. Wide: one line. */
const rowClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 @xl:grid-cols-[3.5rem_9rem_7.5rem_minmax(0,1fr)_auto]'

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
      <div className="border-y border-gray-alpha-400">
        {slotKeys.map((k) => {
          const v = title.versions.find((x) => x.slot === k)
          return v ? (
            <VersionRow key={k} version={v} kind={title.kind} profiles={profiles} profileName={profileName} onCoverage={onCoverage} />
          ) : (
            <EmptyRow key={k} slot={k} titleId={title.id} kind={title.kind} profiles={profiles} />
          )
        })}
      </div>
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
    <div role="group" aria-label={slotLabel[v.slot]} className="border-b border-gray-alpha-400 last:border-b-0">
      <div className={rowClass}>
        <div className="flex min-w-0 items-center gap-3 @xl:contents">
          <span className="label-12-mono text-gray-900">{slotLabel[v.slot]}</span>
          <span className="label-14 truncate">{profileName(v.profile)}</span>
          <span>
            <StatusBadge state={v.state} longMissing={v.long_missing} />
          </span>
        </div>
        <Menu.Container position="bottom-end" className="@xl:order-last">
          <Menu.Button svgOnly variant="tertiary" size="small" aria-label={`More ${slotLabel[v.slot]} Version actions`}>
            <MoreHorizontal />
          </Menu.Button>
          <Menu>
            <Menu.Item onSelect={() => setMode('switch')}>Change Profile</Menu.Item>
            <Menu.Divider />
            {movie && (
              <Menu.Item type="error" disabled={!v.file} description={v.file ? undefined : 'No file to delete'} onSelect={() => setMode('delete')}>
                Delete file
              </Menu.Item>
            )}
            <Menu.Item type="error" onSelect={() => setMode('remove')}>
              Remove Version
            </Menu.Item>
          </Menu>
        </Menu.Container>
        <div className="col-span-2 min-w-0 @xl:col-span-1">
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
    <div role="group" aria-label={slotLabel[slot]} className="border-b border-gray-alpha-400 last:border-b-0">
      <div className={`${rowClass} !py-2`}>
        <div className="flex min-w-0 items-center gap-3 @xl:contents">
          <span className="label-12-mono text-gray-900">{slotLabel[slot]}</span>
          <span className="copy-13 text-gray-900 @xl:col-span-2">Not kept</span>
        </div>
        {options.length > 0 ? (
          <FilterMenu
            single
            label="Add Version"
            size="small"
            align="end"
            className="justify-self-end @xl:col-start-5"
            disabled={add.isPending}
            value={choice ?? initial}
            items={options.map((p: Profile) => ({ value: p.key, label: p.name }))}
            onChange={(profile: string) => {
              setChoice(profile)
              add.mutate({ slot, profile })
            }}
          />
        ) : (
          <span />
        )}
      </div>
      {add.error && (
        <div className="pb-2">
          <Note variant="error" size="small">
            {add.error.message}
          </Note>
        </div>
      )}
    </div>
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
      <button type="button" title="Show the episodes" onClick={onCoverage} className="label-13 text-left text-gray-900 hover:text-gray-1000 hover:underline">
        {parts.join(' · ')}
      </button>
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
          <button type="button" title={f.path} className="label-13-mono block max-w-full truncate text-left hover:underline">
            {base(f.path)}
          </button>
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

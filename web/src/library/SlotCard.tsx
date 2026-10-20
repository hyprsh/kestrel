// One Slot of a Title on its page: the Version kept there, or room to add one.
import type { Profile, TitleDetail } from '../api/queries'
import { Badge, cx } from '../ui'
import { size, slotLabel, StatusBadge, type SlotKey } from './bits'
import { DeleteFile } from './DeleteFiles'
import { AddVersion, VersionControls } from './ManageVersion'

type Version = TitleDetail['versions'][number]

/**
 * A Slot card. Filled or empty, it has the same three parts in the same
 * places: a header (the Slot's name, its state badge on the right), what the
 * Slot holds, and an actions area at the bottom. Per-Version actions go in
 * that area, next to Change Profile and Remove Version.
 */
export function SlotCard({
  slot,
  title,
  profiles,
  profileName,
  onCoverage,
}: {
  slot: SlotKey
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onCoverage: () => void
}) {
  const v = title.versions.find((x) => x.slot === slot)
  return (
    <div role="group" aria-label={slotLabel[slot]} className={cx('flex flex-col rounded-lg border border-gray-alpha-400 p-3', !v && 'border-dashed')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium text-gray-900">{slotLabel[slot]}</span>
        {v ? <StatusBadge state={v.state} longMissing={v.long_missing} /> : <Badge>No Version</Badge>}
      </div>
      <div className="mt-2 min-w-0 flex-1">
        {v ? (
          <>
            <div className="text-[13px] font-medium">{profileName(v.profile)}</div>
            <Holds version={v} kind={title.kind} onCoverage={onCoverage} />
          </>
        ) : (
          <div className="text-[13px] text-gray-900">Not kept in {slotLabel[slot]}</div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {v ? <VersionControls versionId={v.id} slot={slot} profile={v.profile} profiles={profiles} /> : <AddVersion titleId={title.id} slot={slot} profiles={profiles} />}
        {v && <DeleteFile versionId={v.id} file={v.file} />}
      </div>
    </div>
  )
}

/**
 * What a Version holds, worded so it never contradicts the badge: a Movie's
 * file, or a Series' episode coverage (Wanted exactly when episodes are).
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
      <button type="button" title="Show the episodes" onClick={onCoverage} className="mt-1 block text-left text-[12px] text-gray-900 hover:text-gray-1000 hover:underline">
        {parts.join(' · ')}
      </button>
    )
  }
  if (!v.file) return <div className="mt-1 text-[12px] text-gray-900">No file yet</div>
  return (
    <div className="mt-1 text-[12px] text-gray-900">
      <div className="truncate font-mono text-[11px]" title={v.file.release_name}>
        {v.file.release_name}
      </div>
      <div>
        {[v.file.quality, v.file.languages?.join(' + '), size(v.file.size)].filter(Boolean).join(' · ')}
        {v.file.score !== null && ` · Score ${v.file.score}`}
      </div>
      {v.file.misfit && <div className="text-red-900">No longer fits this Profile</div>}
    </div>
  )
}

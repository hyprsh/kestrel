import { Button, Checkbox, DestructiveActionModal, Note, Select } from '@hyprsh/design'
import { useState, type ReactNode } from 'react'
import type { Profile } from '../api/queries'
import { useAddVersion, useRemoveTitle, useRemoveVersion, useSwitchProfile } from '../api/versions'
import type { SlotKey } from './bits'

/**
 * Asks before removing, in a modal. "Also delete files" is unticked by default:
 * removing never loses a file by accident. `children` go above it, such as what
 * a bulk removal covers. The caller shows it only while it is asked.
 */
export function RemoveConfirm({
  what,
  onConfirm,
  onCancel,
  error,
  busy,
  children,
}: {
  what: string
  onConfirm: (deleteFiles: boolean) => void
  onCancel: () => void
  error?: string
  busy: boolean
  children?: ReactNode
}) {
  const [deleteFiles, setDeleteFiles] = useState(false)
  return (
    <DestructiveActionModal
      open
      title={`Remove ${what}`}
      confirmLabel="Remove"
      description={
        <div className="flex flex-col gap-3">
          {children}
          <Checkbox checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)}>
            Also delete files
          </Checkbox>
        </div>
      }
      loading={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={() => onConfirm(deleteFiles)}
    />
  )
}

/** A Profile picker that only exists while it is open, so closed columns stay plain text. */
function ProfilePicker({
  profiles,
  slot,
  initial,
  label,
  busy,
  error,
  onPick,
  onCancel,
}: {
  profiles: Profile[]
  slot: SlotKey
  initial: string
  label: string
  busy: boolean
  error?: string
  onPick: (profile: string) => void
  onCancel: () => void
}) {
  const options = profiles.filter((p) => p.slot === slot && p.enabled)
  const [choice, setChoice] = useState(options.some((p) => p.key === initial) ? initial : (options[0]?.key ?? ''))
  return (
    <div role="group" aria-label={label} className="mt-2">
      <Select size="small" aria-label="Profile" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {options.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </Select>
      {error && (
        <div className="mt-2">
          <Note variant="error" size="small">
            {error}
          </Note>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" size="small" disabled={busy || !choice} onClick={() => onPick(choice)}>
          {label === 'Add Version' ? 'Add' : 'Switch'}
        </Button>
        <Button variant="secondary" size="small" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Switch Profile and remove, under a filled Slot column. */
export function VersionControls({ versionId, slot, profile, profiles }: { versionId: number; slot: SlotKey; profile: string; profiles: Profile[] }) {
  const sw = useSwitchProfile(versionId)
  const rm = useRemoveVersion(versionId)
  const [mode, setMode] = useState<'switch' | 'remove' | null>(null)
  if (mode === 'switch') {
    return (
      <ProfilePicker
        profiles={profiles}
        slot={slot}
        initial={profile}
        label="Switch Profile"
        busy={sw.isPending}
        error={sw.error?.message}
        onCancel={() => setMode(null)}
        onPick={(p) => sw.mutate(p, { onSuccess: () => setMode(null) })}
      />
    )
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="secondary" size="small" className="flex-1" onClick={() => setMode('switch')}>
        Change Profile
      </Button>
      <Button variant="secondary" size="small" className="flex-1" onClick={() => setMode('remove')}>
        Remove Version
      </Button>
      {mode === 'remove' && <RemoveConfirm what="Version" busy={rm.isPending} error={rm.error?.message} onCancel={() => setMode(null)} onConfirm={(d) => rm.mutate(d)} />}
    </div>
  )
}

/** Add a Version to an empty Slot; it is searched at once. */
export function AddVersion({ titleId, slot, profiles }: { titleId: number; slot: SlotKey; profiles: Profile[] }) {
  const add = useAddVersion(titleId)
  const [open, setOpen] = useState(false)
  if (!profiles.some((p) => p.slot === slot && p.enabled)) return null
  if (!open) {
    return (
      <Button variant="secondary" size="small" className="mt-2 w-full" onClick={() => setOpen(true)}>
        Add Version
      </Button>
    )
  }
  const defaults = profiles.find((p) => p.slot === slot && p.enabled && p.default_movies)
  return (
    <ProfilePicker
      profiles={profiles}
      slot={slot}
      initial={defaults?.key ?? ''}
      label="Add Version"
      busy={add.isPending}
      error={add.error?.message}
      onCancel={() => setOpen(false)}
      onPick={(p) => add.mutate({ slot, profile: p }, { onSuccess: () => setOpen(false) })}
    />
  )
}

/** Asks before removing the whole Title; the Title actions' "…" menu opens it. */
export function RemoveTitle({ titleId, onCancel }: { titleId: number; onCancel: () => void }) {
  const rm = useRemoveTitle(titleId)
  return <RemoveConfirm what="Title" busy={rm.isPending} error={rm.error?.message} onCancel={onCancel} onConfirm={(d) => rm.mutate(d)} />
}

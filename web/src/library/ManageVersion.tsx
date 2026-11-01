import { Button, Checkbox, DestructiveActionModal, Modal, Note, Select } from '@hyprsh/design'
import { useState, type ReactNode } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { useAddVersion, useRemoveTitle } from '../api/versions'
import { useReport } from '../toasts'
import { slotKeys, slotLabel, type SlotKey } from './bits'

/**
 * Asks before removing, in a modal that closes on confirm: the caller reports the outcome as a Toast.
 * "Also delete files" is unticked by default: removing never loses a file by accident. `children` go above it, such as what
 * a bulk removal covers. The caller shows it only while it is asked.
 */
export function RemoveConfirm({ what, onConfirm, onCancel, children }: { what: string; onConfirm: (deleteFiles: boolean) => void; onCancel: () => void; children?: ReactNode }) {
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
      onCancel={onCancel}
      onConfirm={() => onConfirm(deleteFiles)}
    />
  )
}

/** A Profile picker in a Modal, shown only while it is open. */
export function ProfilePicker({
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
    <Modal
      open
      size="small"
      title={label}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" size="small" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="small" disabled={busy || !choice} onClick={() => onPick(choice)}>
            Switch
          </Button>
        </>
      }
    >
      <div role="group" aria-label={label} className="flex flex-col gap-3">
        <Select size="small" aria-label="Profile" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
        {error && (
          <Note variant="error" size="small">
            {error}
          </Note>
        )}
      </div>
    </Modal>
  )
}

/** Asks before removing the whole Title; the Title actions' "…" menu opens it. */
export function RemoveTitle({ titleId, onCancel }: { titleId: number; onCancel: () => void }) {
  const rm = useRemoveTitle(titleId)
  const report = useReport()
  const confirm = (d: boolean) => {
    onCancel()
    void report(rm.mutateAsync(d), { done: 'Title removed', failed: 'Could not remove the Title' })
  }
  return <RemoveConfirm what="Title" onCancel={onCancel} onConfirm={confirm} />
}

/**
 * Adds a Version for a Slot the Title does not keep: a Slot and a Profile of that Slot, the default Profile of the Title's kind
 * selected. The Title menu's "Add Version…" opens it, only while a Slot is free.
 */
export function AddVersion({ title, profiles, onClose }: { title: TitleDetail; profiles: Profile[]; onClose: () => void }) {
  const add = useAddVersion(title.id)
  const free = slotKeys.filter((k) => !title.versions.some((v) => v.slot === k))
  const [slot, setSlot] = useState<SlotKey>(free[0])
  const options = (k: SlotKey) => profiles.filter((p) => p.slot === k && p.enabled)
  const initial = (k: SlotKey) => (options(k).find((p) => (title.kind === 'series' ? p.default_series : p.default_movies)) ?? options(k)[0])?.key ?? ''
  const [profile, setProfile] = useState(initial(free[0]))
  const pick = (k: SlotKey) => {
    setSlot(k)
    setProfile(initial(k))
  }
  return (
    <Modal
      open
      size="small"
      title="Add Version"
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="small" disabled={add.isPending || !profile} onClick={() => add.mutate({ slot, profile }, { onSuccess: onClose })}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select size="small" aria-label="Slot" value={slot} onChange={(e) => pick(e.target.value as SlotKey)}>
          {free.map((k) => (
            <option key={k} value={k}>
              {slotLabel[k]}
            </option>
          ))}
        </Select>
        <Select size="small" aria-label="Profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {options(slot).map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
        {add.error && (
          <Note variant="error" size="small">
            {add.error.message}
          </Note>
        )}
      </div>
    </Modal>
  )
}

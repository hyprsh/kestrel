import { useState } from 'react'
import type { Profile } from '../api/queries'
import { useAddVersion, useRemoveTitle, useRemoveVersion, useSwitchProfile } from '../api/versions'
import { Button, ErrorText, Select } from '../forms'
import type { SlotKey } from './bits'

/** "Also delete files" is unticked by default: removing never loses a file by accident. */
function RemoveConfirm({
  what,
  onConfirm,
  onCancel,
  error,
  busy,
}: {
  what: string
  onConfirm: (deleteFiles: boolean) => void
  onCancel: () => void
  error?: string
  busy: boolean
}) {
  const [deleteFiles, setDeleteFiles] = useState(false)
  return (
    <div role="group" aria-label={`Remove ${what}`} className="mt-2 rounded-md border border-gray-alpha-400 p-2 text-[12px]">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
        Also delete files
      </label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-2 flex gap-2">
        <Button variant="danger" className="h-7" disabled={busy} onClick={() => onConfirm(deleteFiles)}>
          Remove
        </Button>
        <Button variant="secondary" className="h-7" onClick={onCancel}>
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
  const [removing, setRemoving] = useState(false)
  const options = profiles.filter((p) => p.slot === slot && p.enabled)
  return (
    <div className="mt-2">
      {options.length > 1 && (
        <Select aria-label="Profile" value={profile} disabled={sw.isPending} onChange={(e) => sw.mutate(e.target.value)}>
          {options.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      {sw.error && <ErrorText>{sw.error.message}</ErrorText>}
      {removing ? (
        <RemoveConfirm what="Version" busy={rm.isPending} error={rm.error?.message} onCancel={() => setRemoving(false)} onConfirm={(d) => rm.mutate(d)} />
      ) : (
        <Button variant="secondary" className="mt-2 h-7 w-full" onClick={() => setRemoving(true)}>
          Remove Version
        </Button>
      )}
    </div>
  )
}

/** Add a Version to an empty Slot; it is searched at once. */
export function AddVersion({ titleId, slot, profiles }: { titleId: number; slot: SlotKey; profiles: Profile[] }) {
  const add = useAddVersion(titleId)
  const options = profiles.filter((p) => p.slot === slot && p.enabled)
  const [choice, setChoice] = useState('')
  const key = choice || options.find((p) => p.default_movies)?.key || options[0]?.key
  if (!key) return null
  return (
    <div className="mt-2">
      {options.length > 1 && (
        <Select aria-label="Profile" value={key} onChange={(e) => setChoice(e.target.value)}>
          {options.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      {add.error && <ErrorText>{add.error.message}</ErrorText>}
      <Button variant="secondary" className="mt-2 h-7 w-full" disabled={add.isPending} onClick={() => add.mutate({ slot, profile: key })}>
        Add Version
      </Button>
    </div>
  )
}

/** Remove the whole Title. */
export function RemoveTitle({ titleId }: { titleId: number }) {
  const rm = useRemoveTitle(titleId)
  const [open, setOpen] = useState(false)
  return open ? (
    <RemoveConfirm what="Title" busy={rm.isPending} error={rm.error?.message} onCancel={() => setOpen(false)} onConfirm={(d) => rm.mutate(d)} />
  ) : (
    <Button variant="secondary" className="mt-6" onClick={() => setOpen(true)}>
      Remove Title
    </Button>
  )
}

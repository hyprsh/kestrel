import { DestructiveActionModal } from '@hyprsh/design'
import { useState } from 'react'
import { useBulkTitles } from '../api/bulk'
import { ApiError, type TitleRow } from '../api/queries'
import type { Slot, useDeleteSlot } from '../api/slots'
import { plural } from '../format'

/**
 * "Delete…" on a Slot. An empty Slot goes after one confirmation. One that holds Versions is deleted with them: the dialog
 * counts the Versions and their files, deletes both from disk and asks for the label to be typed. The Versions go first, then
 * the Slot; a rule the server still refuses shows under the field.
 */
export function DeleteSlot({ slot, titles, remove, onClose }: { slot: Slot; titles: TitleRow[]; remove: ReturnType<typeof useDeleteSlot>; onClose: () => void }) {
  const bulk = useBulkTitles()
  const [problem, setProblem] = useState<string | null>(null)
  const holding = titles.flatMap((t) => t.slot_states.filter((s) => s.slot === slot.id).map((s) => ({ title: t.id, filled: s.state === 'filled' })))
  const files = holding.filter((h) => h.filled).length

  const confirm = async () => {
    setProblem(null)
    try {
      if (holding.length > 0) await bulk.mutateAsync({ action: 'remove_version', title_ids: holding.map((h) => h.title), slot: slot.id, delete_files: true })
      await remove.mutateAsync(slot.id)
      onClose()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not delete the Slot. Try again.')
    }
  }

  return (
    <DestructiveActionModal
      open
      title="Delete Slot"
      description={
        holding.length > 0
          ? `${slot.label} holds ${plural(holding.length, 'Version')}, ${files === 0 ? 'none' : `${files}`} with a file. Deleting it deletes them too.`
          : `${slot.label} holds no Versions. Kestrel stops offering it.`
      }
      irreversibleDescription={files > 0 ? `${plural(files, 'file')} will be deleted from disk.` : undefined}
      verificationPhrase={holding.length > 0 ? slot.label : undefined}
      verificationLabel="Slot label"
      confirmLabel="Delete Slot"
      loading={bulk.isPending || remove.isPending}
      error={problem}
      onCancel={onClose}
      onConfirm={() => void confirm()}
    />
  )
}

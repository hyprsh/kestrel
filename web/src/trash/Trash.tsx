import { usePatchSettings, useSettings, useUpdateTrash } from '../api/queries'
import { SkeletonForm } from '../loading'
import { useStatus } from '../api/attention'
import { snapshotAge } from '../overview/HealthStrip'
import { Button, Checkbox, Code } from '@hyprsh/design'
import { useReport } from '../toasts'
import { trashStarted } from './toasts'

/** The daily TRaSH check's switch, the active snapshot and "Update from TRaSH". */
export function TrashForm() {
  const settings = useSettings()
  const status = useStatus()
  const patch = usePatchSettings()
  const update = useUpdateTrash()
  const report = useReport()
  if (!settings.data) return <SkeletonForm rows={2} />
  const snapshot = status.data?.trash

  return (
    <div className="flex max-w-md flex-col gap-3">
      <Checkbox checked={settings.data.trash.auto_update} disabled={patch.isPending} onChange={(e) => patch.mutate({ trash: { auto_update: e.target.checked } })}>
        Check TRaSH daily and update automatically
      </Checkbox>
      {snapshot && (
        <p className="label-12 text-gray-900">
          Using TRaSH commit <Code>{snapshot.commit.slice(0, 7)}</Code>, {snapshotAge(snapshot.committed_at)}.
        </p>
      )}
      <Button
        variant="secondary"
        size="small"
        loading={update.isPending}
        onClick={() => void report(update.mutateAsync(), { started: trashStarted, failed: 'Update from TRaSH failed' })}
        className="self-start"
      >
        Update from TRaSH
      </Button>
    </div>
  )
}

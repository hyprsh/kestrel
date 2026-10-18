import { ApiError, usePatchSettings, useSettings, useUpdateTrash } from '../api/queries'
import { useStatus } from '../api/attention'
import { snapshotAge } from '../overview/HealthStrip'
import { Button, ErrorText } from '../forms'

/** The daily TRaSH check's switch, the active snapshot and "Update from TRaSH". */
export function TrashForm() {
  const settings = useSettings()
  const status = useStatus()
  const patch = usePatchSettings()
  const update = useUpdateTrash()
  if (!settings.data) return null
  const snapshot = status.data?.trash

  return (
    <div className="flex max-w-md flex-col gap-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.data.trash.auto_update}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate({ trash: { auto_update: e.target.checked } })}
        />
        Check TRaSH daily and update automatically
      </label>
      {snapshot && (
        <p className="text-[12px] text-gray-900">
          Using TRaSH commit <code>{snapshot.commit.slice(0, 7)}</code>, {snapshotAge(snapshot.committed_at)}.
        </p>
      )}
      {update.isError && (
        <ErrorText>
          {update.error instanceof ApiError && update.error.status === 422
            ? 'TRaSH’s newest set was rejected. The previous one stays in use.'
            : 'Could not reach TRaSH. Try again later.'}
        </ErrorText>
      )}
      {update.isSuccess && (
        <p role="status" className="text-[12px] text-green-900">
          {update.data.changed ? 'Updated.' : 'Already up to date.'}
        </p>
      )}
      <Button variant="secondary" disabled={update.isPending} onClick={() => update.mutate()} className="self-start">
        Update from TRaSH
      </Button>
    </div>
  )
}

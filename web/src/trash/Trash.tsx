import { ApiError, usePatchSettings, useSettings, useUpdateTrash } from '../api/queries'
import { useStatus } from '../api/attention'
import { snapshotAge } from '../overview/HealthStrip'
import { Button, Checkbox, Code, Note } from '@hyprsh/design'

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
      <Checkbox checked={settings.data.trash.auto_update} disabled={patch.isPending} onChange={(e) => patch.mutate({ trash: { auto_update: e.target.checked } })}>
        Check TRaSH daily and update automatically
      </Checkbox>
      {snapshot && (
        <p className="label-12 text-gray-900">
          Using TRaSH commit <Code>{snapshot.commit.slice(0, 7)}</Code>, {snapshotAge(snapshot.committed_at)}.
        </p>
      )}
      {update.isError && (
        <Note variant="error" size="small">
          {update.error instanceof ApiError && update.error.status === 422 ? 'TRaSH’s newest set was rejected. The previous one stays in use.' : 'Could not reach TRaSH. Try again later.'}
        </Note>
      )}
      {update.isSuccess && (
        <p role="status" className="label-12 text-green-900">
          {update.data.changed ? 'Updated.' : 'Already up to date.'}
        </p>
      )}
      <Button variant="secondary" size="small" loading={update.isPending} onClick={() => update.mutate()} className="self-start">
        Update from TRaSH
      </Button>
    </div>
  )
}

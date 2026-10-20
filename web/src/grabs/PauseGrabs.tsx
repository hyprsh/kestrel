// The "Pause grabs" switch (Settings, Grabs).
import { ApiError, usePatchSettings, useSettings } from '../api/queries'
import { ErrorText } from '../forms'

export function PauseGrabsSwitch() {
  const { data } = useSettings()
  const save = usePatchSettings()
  if (!data) return null
  return (
    <>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={data.pause_grabs}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ pause_grabs: e.target.checked })}
        />
        <span>
          Pause grabs
          <span className="mt-0.5 block text-[12px] text-gray-900">
            Searches keep running, so Wanted and Upgrade candidates still show up, but nothing is sent to the download client
            on its own. A Release you grab by hand still goes through. Turning it off lets the next sweep grab as usual.
          </span>
        </span>
      </label>
      {save.isError && <ErrorText>{save.error instanceof ApiError ? save.error.message : 'Could not save.'}</ErrorText>}
    </>
  )
}

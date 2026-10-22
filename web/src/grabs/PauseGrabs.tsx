// The "Pause Grabs" switch (Settings, Grabs).
import { ApiError, usePatchSettings, useSettings } from '../api/queries'
import { Checkbox, Note } from '@hyprsh/design'

export function PauseGrabsSwitch() {
  const { data } = useSettings()
  const save = usePatchSettings()
  if (!data) return null
  return (
    <>
      <Checkbox
        checked={data.pause_grabs}
        disabled={save.isPending}
        onChange={(e) => save.mutate({ pause_grabs: e.target.checked })}
        description="Searches keep running, so Wanted and Upgrade candidates still show up, but nothing is sent to the download client on its own. A Release you grab by hand still goes through. Turning it off lets the next sweep grab as usual."
      >
        Pause Grabs
      </Checkbox>
      {save.isError && (
        <Note variant="error" size="small">
          {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
        </Note>
      )}
    </>
  )
}

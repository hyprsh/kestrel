// The "Automatic Grabs" switch (Settings, Downloads): the inverse of the Pause Grabs setting.
import { Note, Toggle } from '@hyprsh/design'
import { ApiError, usePatchSettings, useSettings } from '../api/queries'
import { SettingRow, SettingsCard } from '../layout/SettingsPage'

/** On means Kestrel grabs what fits on its own; off pauses Grabs (`pause_grabs`). It applies at once, as it always did. */
export function AutomaticGrabsRow() {
  const { data } = useSettings()
  const save = usePatchSettings()
  if (!data) return null
  return (
    <SettingsCard>
      <SettingRow
        label="Grab automatically"
        help="Search passes grab what fits. Turn it off, for example after a large Adoption, to look first: searches keep running and Wanted and Upgrade candidates still show up, but nothing is sent to the download client on its own. A Release you grab by hand still goes through."
      >
        <Toggle aria-label="Grab automatically" checked={!data.pause_grabs} disabled={save.isPending} onChange={(on) => save.mutate({ pause_grabs: !on })} />
        {save.isError && (
          <Note variant="error" size="small">
            {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
          </Note>
        )}
      </SettingRow>
    </SettingsCard>
  )
}

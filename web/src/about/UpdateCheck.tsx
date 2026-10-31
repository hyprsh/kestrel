// The one "Check GitHub for updates" switch (Settings, Updates).
import { usePatchSettings, useSettings } from '../api/queries'
import { Checkbox, Note, useToasts } from '@hyprsh/design'

export function UpdateCheckSwitch() {
  const { data } = useSettings()
  const save = usePatchSettings()
  const toasts = useToasts()
  if (!data) return null
  const declared = data.from_config_file.check_github_updates
  return (
    <>
      <Checkbox
        checked={data.check_github_updates}
        disabled={save.isPending || declared}
        onChange={(e) => save.mutate({ check_github_updates: e.target.checked }, { onError: (err) => toasts.error(`Could not save the update check: ${err.message}`) })}
        description="Once a day Kestrel asks GitHub for a newer release, security advisories and a newer TRaSH commit. Off means no request to GitHub at all."
      >
        Check GitHub for updates
      </Checkbox>
      {declared && (
        <Note size="small" className="mt-2">
          The Config File sets this switch, so it cannot be changed here. Change the file and restart Kestrel instead.
        </Note>
      )}
    </>
  )
}

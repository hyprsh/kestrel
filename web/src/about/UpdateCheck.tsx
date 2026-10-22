// The one "Check GitHub for updates" switch (Settings, Updates).
import { usePatchSettings, useSettings } from '../api/queries'
import { Checkbox, Note } from '@hyprsh/design'

export function UpdateCheckSwitch() {
  const { data } = useSettings()
  const save = usePatchSettings()
  if (!data) return null
  const declared = data.from_config_file.check_github_updates
  return (
    <>
      <Checkbox
        checked={data.check_github_updates}
        disabled={save.isPending || declared}
        onChange={(e) => save.mutate({ check_github_updates: e.target.checked })}
      >
        <span className="label-14">Check GitHub for updates</span>
        <span className="copy-13 mt-0.5 block text-gray-900">
          Once a day Kestrel asks GitHub for a newer release, security advisories and a newer TRaSH commit. Off means no request to GitHub at all.
        </span>
      </Checkbox>
      {declared && (
        <Note size="small" className="mt-2">
          The Config File sets this switch, so it cannot be changed here. Change the file and restart Kestrel instead.
        </Note>
      )}
    </>
  )
}

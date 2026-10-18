// The one "Check GitHub for updates" switch (Settings, Updates).
import { usePatchSettings, useSettings } from '../api/queries'

export function UpdateCheckSwitch() {
  const { data } = useSettings()
  const save = usePatchSettings()
  if (!data) return null
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={data.check_github_updates}
        disabled={save.isPending}
        onChange={(e) => save.mutate({ check_github_updates: e.target.checked })}
      />
      <span>
        Check GitHub for updates
        <span className="mt-0.5 block text-[12px] text-gray-900">
          Once a day Kestrel asks GitHub for a newer release, security advisories and a newer TRaSH commit. Off means no request to GitHub at all.
        </span>
      </span>
    </label>
  )
}

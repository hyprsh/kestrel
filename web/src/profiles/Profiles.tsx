import { ApiError, usePatchProfile, useProfiles, type Profile } from '../api/queries'
import { ErrorText, Select } from '../forms'

const slots = [
  { slot: 'sd', label: 'SD' },
  { slot: 'hd', label: 'HD' },
  { slot: 'uhd', label: 'UHD' },
] as const

const problemText = (e: unknown) => (e instanceof ApiError && e.status === 422 ? e.message : 'Could not save. Try again.')

/**
 * One default Profile per Slot for Movies and for Series. HD always has one;
 * SD and UHD can have none. A change saves at once.
 */
export function DefaultsPerSlot() {
  const profiles = useProfiles()
  const patch = usePatchProfile()
  if (profiles.isError) return <p className="text-[12px] text-red-900">Could not load the Profiles.</p>
  if (!profiles.data) return null

  const kinds = [
    { kind: 'Movies', flag: 'default_movies' },
    { kind: 'Series', flag: 'default_series' },
  ] as const

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-w-md grid-cols-[3rem_1fr_1fr] items-center gap-x-3 gap-y-2">
        <span />
        {kinds.map((k) => (
          <span key={k.kind} className="text-[12px] font-medium text-gray-900">
            {k.kind}
          </span>
        ))}
        {slots.map(({ slot, label }) => {
          const inSlot = profiles.data.filter((p) => p.slot === slot)
          return (
            <Row key={slot} label={label}>
              {kinds.map(({ kind, flag }) => {
                const current = inSlot.find((p) => p[flag])
                return (
                  <Select
                    key={kind}
                    aria-label={`${label} default for ${kind}`}
                    value={current?.key ?? ''}
                    onChange={(e) => {
                      const key = e.target.value
                      if (key) patch.mutate({ key, patch: { [flag]: true } })
                      else if (current) patch.mutate({ key: current.key, patch: { [flag]: false } })
                    }}
                  >
                    {slot !== 'hd' && <option value="">None</option>}
                    {inSlot
                      .filter((p) => p.enabled)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name}
                        </option>
                      ))}
                  </Select>
                )
              })}
            </Row>
          )
        })}
      </div>
      {patch.isError && <ErrorText>{problemText(patch.error)}</ErrorText>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="font-medium">{label}</span>
      {children}
    </>
  )
}

/** Settings: enable or disable each Profile and set the Original-Language fallback of Primary-Language ones. */
export function ProfileToggles() {
  const profiles = useProfiles()
  const patch = usePatchProfile()
  if (profiles.isError) return <p className="text-[12px] text-red-900">Could not load the Profiles.</p>
  if (!profiles.data) return null

  const toggle = (p: Profile, change: { enabled?: boolean; original_fallback?: boolean }) => patch.mutate({ key: p.key, patch: change })

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-gray-alpha-400">
        {profiles.data.map((p) => (
          <li key={p.key} className="flex items-center gap-4 py-1.5">
            <label className="flex w-48 items-center gap-2">
              <input type="checkbox" aria-label={`${p.name} enabled`} checked={p.enabled} onChange={(e) => toggle(p, { enabled: e.target.checked })} />
              <span className="font-medium">{p.name}</span>
              <span className="text-[12px] text-gray-900">{p.slot.toUpperCase()}</span>
            </label>
            {p.language_rule === 'primary' ? (
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  aria-label={`${p.name} fallback to the Original Language`}
                  checked={p.original_fallback}
                  onChange={(e) => toggle(p, { original_fallback: e.target.checked })}
                />
                Accept the Original Language when no Primary-Language audio exists
              </label>
            ) : (
              <span className="text-[12px] text-gray-900">Requires the Title’s Original Language</span>
            )}
          </li>
        ))}
      </ul>
      {patch.isError && <ErrorText>{problemText(patch.error)}</ErrorText>}
    </div>
  )
}

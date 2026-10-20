import { ApiError, usePatchProfile, useProfiles, type Profile } from '../api/queries'
import { DeclaredNote, ErrorText, Select } from '../forms'
import { slotKeys, slotLabel } from '../library/bits'

const problemText = (e: unknown) => (e instanceof ApiError && e.status === 422 ? e.message : 'Could not save. Try again.')

/** Profiles are declared together: the Config File sets all of them or none. */
const declaresProfiles = (profiles: Profile[]) => profiles.some((p) => p.from_config_file)
const declaredNote = <DeclaredNote>The Config File sets the Profiles, so they cannot be changed here.</DeclaredNote>

/**
 * One default Profile per Slot for Movies and for Series. Standard always has one;
 * 4K can have none. A change saves at once.
 */
export function DefaultsPerSlot() {
  const profiles = useProfiles()
  const patch = usePatchProfile()
  if (profiles.isError) return <p className="text-[12px] text-red-900">Could not load the Profiles.</p>
  if (!profiles.data) return null
  const declared = declaresProfiles(profiles.data)

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
        {slotKeys.map((slot) => {
          const label = slotLabel[slot]
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
                    disabled={declared}
                    onChange={(e) => {
                      const key = e.target.value
                      if (key) patch.mutate({ key, patch: { [flag]: true } })
                      else if (current) patch.mutate({ key: current.key, patch: { [flag]: false } })
                    }}
                  >
                    {slot !== 'standard' && <option value="">None</option>}
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
      {declared && declaredNote}
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

/** What a Primary-Language Profile does with a Release that has the Original Language but no Primary-Language audio. */
const originalChoices: { value: Profile['original_language']; label: string }[] = [
  { value: 'reject', label: 'Reject' },
  { value: 'offer', label: 'Offer for approval' },
  { value: 'accept', label: 'Grab' },
]

/** Settings: enable or disable each Profile and choose what Primary-Language ones do with Original-only Releases. */
export function ProfileToggles() {
  const profiles = useProfiles()
  const patch = usePatchProfile()
  if (profiles.isError) return <p className="text-[12px] text-red-900">Could not load the Profiles.</p>
  if (!profiles.data) return null
  const declared = declaresProfiles(profiles.data)

  const toggle = (p: Profile, change: { enabled?: boolean; original_language?: Profile['original_language'] }) => patch.mutate({ key: p.key, patch: change })

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-gray-alpha-400">
        {profiles.data.map((p) => (
          <li key={p.key} className="flex items-center gap-4 py-1.5">
            <label className="flex w-48 items-center gap-2">
              <input type="checkbox" aria-label={`${p.name} enabled`} checked={p.enabled} disabled={declared} onChange={(e) => toggle(p, { enabled: e.target.checked })} />
              <span className="font-medium">{p.name}</span>
              <span className="text-[12px] text-gray-900">{slotLabel[p.slot]}</span>
            </label>
            {p.language_rule === 'primary' ? (
              <label className="flex items-center gap-2 text-[12px]">
                Original Language only
                <Select
                  aria-label={`${p.name} Original Language only`}
                  className="w-auto"
                  value={p.original_language}
                  disabled={declared}
                  onChange={(e) => toggle(p, { original_language: e.target.value as Profile['original_language'] })}
                >
                  {originalChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <span className="text-[12px] text-gray-900">Requires the Title’s Original Language</span>
            )}
          </li>
        ))}
      </ul>
      {patch.isError && <ErrorText>{problemText(patch.error)}</ErrorText>}
      {declared && declaredNote}
    </div>
  )
}

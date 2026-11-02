import { Note, Select } from '@hyprsh/design'
import { SkeletonRows } from '../loading'
import { ApiError, usePatchProfile, useProfiles, type Profile } from '../api/queries'
import { useSlotNames } from '../library/slots'
import { useReport } from '../toasts'

const problemText = (e: unknown) => (e instanceof ApiError && e.status === 422 ? e.message : 'Could not save. Try again.')

/** Profiles are declared together: the Config File sets all of them or none. */
export const declaresProfiles = (profiles: Profile[]) => profiles.some((p) => p.from_config_file)
export const declaredNote = <Note size="small">The Config File sets the Profiles, so they cannot be changed here. Change the file and restart Kestrel instead.</Note>

/**
 * One default Profile per Slot for Movies and for Series. Standard always has one;
 * 4K can have none. A change saves at once.
 */
export function DefaultsPerSlot() {
  const profiles = useProfiles()
  const patch = usePatchProfile()
  const report = useReport()
  const slots = useSlotNames()
  if (profiles.isError)
    return (
      <Note variant="error" size="small">
        Could not load the Profiles.
      </Note>
    )
  if (!profiles.data) return <SkeletonRows count={3} />
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
          <span key={k.kind} className="label-13 text-gray-900">
            {k.kind}
          </span>
        ))}
        {slots.list.map(({ id: slot, label }) => {
          const inSlot = profiles.data.filter((p) => p.slot === slot)
          return (
            <Row key={slot} label={label}>
              {kinds.map(({ kind, flag }) => {
                const current = inSlot.find((p) => p[flag])
                return (
                  <Select
                    size="small"
                    key={kind}
                    aria-label={`${label} default for ${kind}`}
                    value={current?.key ?? ''}
                    disabled={declared}
                    onChange={(e) => {
                      const key = e.target.value
                      const saved = { done: `Saved the ${label} default for ${kind}` }
                      if (key) void report(patch.mutateAsync({ key, patch: { [flag]: true } }), saved)
                      else if (current) void report(patch.mutateAsync({ key: current.key, patch: { [flag]: false } }), saved)
                    }}
                  >
                    {slot !== slots.list[0]?.id && <option value="">None</option>}
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
      {patch.isError && (
        <Note variant="error" size="small">
          {problemText(patch.error)}
        </Note>
      )}
      {declared && declaredNote}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="label-14">{label}</span>
      {children}
    </>
  )
}

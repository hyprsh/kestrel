import { Note, Select } from '@hyprsh/design'
import { SkeletonRows } from '../loading'
import { ApiError, useProfiles, type Profile } from '../api/queries'
import { declaresSlots, useSlots, usePatchSlot } from '../api/slots'
import { SlotWarnings } from '../slots/SlotWarnings'
import { useReport } from '../toasts'

const problemText = (e: unknown) => (e instanceof ApiError && e.status === 422 ? e.message : 'Could not save. Try again.')

/** Profiles are declared together: the Config File sets all of them or none. */
export const declaresProfiles = (profiles: Profile[]) => profiles.some((p) => p.from_config_file)
export const declaredNote = <Note size="small">The Config File sets the Profiles, so they cannot be changed here. Change the file and restart Kestrel instead.</Note>
/** The defaults belong to the Slots, so the Slots' declaration locks them, not the Profiles'. */
export const declaredSlotsNote = <Note size="small">The Config File sets the Slots, so their defaults cannot be changed here. Change the file and restart Kestrel instead.</Note>

/**
 * The default Profile each Slot gives a new Movie and a new Series (ADR 0024). Any enabled Profile can fill any Slot, and a
 * Slot can have none. A change saves at once. Slots are added, renamed and removed in Settings, Library.
 */
export function DefaultsPerSlot() {
  const profiles = useProfiles()
  const slots = useSlots()
  const patch = usePatchSlot()
  const report = useReport()
  if (profiles.isError || slots.isError)
    return (
      <Note variant="error" size="small">
        Could not load the Slots and Profiles.
      </Note>
    )
  if (!profiles.data || !slots.data) return <SkeletonRows count={3} />
  const declared = declaresSlots(slots.data)
  const enabled = profiles.data.filter((p) => p.enabled)

  const kinds = [
    { kind: 'Movies', field: 'default_movies' },
    { kind: 'Series', field: 'default_series' },
  ] as const

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-w-md grid-cols-[4rem_1fr_1fr] items-center gap-x-3 gap-y-2">
        <span />
        {kinds.map((k) => (
          <span key={k.kind} className="label-13 text-gray-900">
            {k.kind}
          </span>
        ))}
        {slots.data.map((slot) => (
          <Row key={slot.id} label={slot.label}>
            {kinds.map(({ kind, field }) => (
              <Select
                size="small"
                key={kind}
                aria-label={`${slot.label} default for ${kind}`}
                value={slot[field] ?? ''}
                disabled={declared}
                onChange={(e) => void report(patch.mutateAsync({ id: slot.id, patch: { [field]: e.target.value } }), { done: `Saved the ${slot.label} default for ${kind}` })}
              >
                <option value="">None</option>
                {enabled.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ))}
          </Row>
        ))}
      </div>
      {patch.isError && (
        <Note variant="error" size="small">
          {problemText(patch.error)}
        </Note>
      )}
      <SlotWarnings />
      {declared && declaredSlotsNote}
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

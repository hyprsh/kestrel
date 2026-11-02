import { Note } from '@hyprsh/design'
import { useSettings } from '../api/queries'

/** What Settings warns about in the Slots (ADR 0024): two Slots naming the same default Profile for one kind. Nothing while there is none. */
export function SlotWarnings() {
  const settings = useSettings()
  const warnings = settings.data?.warnings?.filter((w) => w.code === 'shared_slot_default') ?? []
  return (
    <>
      {warnings.map((w) => (
        <Note key={`${w.kind}-${w.profile}`} variant="warning" size="small">
          {w.message}
        </Note>
      ))}
    </>
  )
}

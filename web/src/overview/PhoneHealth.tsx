// The Health pill at the top of the Overview, on a phone only: the phone's top bar has no room for it. A desktop
// carries the pill in its top bar, so there this renders nothing.
import { usePhone } from '../responsive'
import { HealthPill } from '../shell/HealthPill'

export function PhoneHealth() {
  const phone = usePhone()
  if (!phone) return null
  return (
    <div className="mb-6">
      <HealthPill />
    </div>
  )
}

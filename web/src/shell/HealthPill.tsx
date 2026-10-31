import { Pill, Skeleton, StatusDot } from '@hyprsh/design'
import { useAttention } from '../api/attention'
import { useSystem } from '../api/queries'
import { useOpenPlace } from '../place'

/**
 * "Health · All checks OK" or "Health · 1 Blocking, 2 Warnings", opening the Health tab. When the server cannot be reached it
 * says "Offline" instead. It sits in the desktop top bar and, on a phone, at the top of the Overview.
 */
export function HealthPill() {
  const openPlace = useOpenPlace()
  const attention = useAttention()
  const offline = useSystem().isError
  if (!offline && !attention.data) return attention.isPending ? <Skeleton width={120} height={24} /> : null
  // Health issues only (their ids start "health-"): a Stuck download, Stalled Imports or a Silo Request are
  // Needs attention rows too, but the Health tab this pill opens does not list them.
  const rows = (attention.data?.rows ?? []).filter((r) => r.id.startsWith('health-'))
  const blocking = rows.filter((r) => r.severity === 'blocking').length
  const warning = rows.length - blocking
  const parts = [blocking > 0 && `${blocking} Blocking`, warning > 0 && `${warning} ${warning === 1 ? 'Warning' : 'Warnings'}`].filter(Boolean)
  const dot = offline ? 'error' : blocking > 0 ? 'error' : warning > 0 ? 'warning' : 'success'
  return (
    <Pill icon={<StatusDot state={dot} label={false} aria-hidden="true" />} onClick={() => openPlace('/activity/health')}>
      {offline ? 'Offline' : `Health · ${parts.length > 0 ? parts.join(', ') : 'All checks OK'}`}
    </Pill>
  )
}

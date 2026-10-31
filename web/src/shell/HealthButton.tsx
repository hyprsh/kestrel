import { Button, StatusDot, Tooltip } from '@hyprsh/design'
import { HeartPulse } from 'lucide-react'
import { useAttention } from '../api/attention'
import { useSystem } from '../api/queries'
import { useOpenPlace } from '../place'

/**
 * Kestrel's health as an icon button with a status dot: green when all checks are OK, amber with Warnings, red with
 * Blocking issues or when the server cannot be reached. Its name and tooltip say it in full ("Health · 1 Blocking, 2
 * Warnings", "Offline") and it opens Activity > Health. It sits in the desktop rail and in the phone's top bar.
 */
export function HealthButton({ tooltipPosition }: { tooltipPosition: 'right' | 'bottom' }) {
  const openPlace = useOpenPlace()
  const attention = useAttention()
  const offline = useSystem().isError
  if (!offline && !attention.data) return null
  // Health issues only (their ids start "health-"): a Stuck download, Stalled Imports or a Silo Request are
  // Needs attention rows too, but the Health tab this button opens does not list them.
  const rows = (attention.data?.rows ?? []).filter((r) => r.id.startsWith('health-'))
  const blocking = rows.filter((r) => r.severity === 'blocking').length
  const warning = rows.length - blocking
  const parts = [blocking > 0 && `${blocking} Blocking`, warning > 0 && `${warning} ${warning === 1 ? 'Warning' : 'Warnings'}`].filter(Boolean)
  const dot = offline || blocking > 0 ? 'error' : warning > 0 ? 'warning' : 'success'
  const label = offline ? 'Offline' : `Health · ${parts.length > 0 ? parts.join(', ') : 'All checks OK'}`
  return (
    <Tooltip text={label} position={tooltipPosition}>
      <Button svgOnly variant="tertiary" aria-label={label} onClick={() => openPlace('/activity/health')}>
        <span className="relative inline-flex">
          <HeartPulse />
          <span className="absolute -top-1 -right-1 inline-flex">
            <StatusDot state={dot} label={false} aria-hidden="true" />
          </span>
        </span>
      </Button>
    </Tooltip>
  )
}

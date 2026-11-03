import { Button, Rail, StatusDot, Tooltip } from '@hyprsh/design'
import { HeartPulse } from 'lucide-react'
import { useSystem } from '../api/queries'
import { useVerdict } from '../health/problems'
import { useOpenPlace } from '../place'

/**
 * Kestrel's health as an icon button with a status dot, in step with the Health screen's verdict: green when all checks are
 * OK, amber with Warnings, red with Blocking issues or when the server cannot be reached. Its name and tooltip say it in full ("Health · 1 Blocking, 2
 * Warnings", "Offline") and it opens the Health screen, where it shows as the current page. It sits in the desktop rail and in the phone's top bar.
 */
export function HealthButton({ tooltipPosition, active }: { tooltipPosition: 'right' | 'bottom'; active?: boolean }) {
  const openPlace = useOpenPlace()
  const { problems, ready } = useVerdict()
  const offline = useSystem().isError
  if (!offline && !ready) return null
  // The verdict's problems: the health rows of Needs attention (a Stuck download, Stalled Imports or a Silo Request are
  // rows too, but the Health screen this button opens does not list them) and any failing check not yet a row.
  const blocking = problems.filter((p) => p.severity === 'blocking').length
  const warning = problems.length - blocking
  const parts = [blocking > 0 && `${blocking} Blocking`, warning > 0 && `${warning} ${warning === 1 ? 'Warning' : 'Warnings'}`].filter(Boolean)
  const dot = offline || blocking > 0 ? 'error' : warning > 0 ? 'warning' : 'success'
  const label = offline ? 'Offline' : `Health · ${parts.length > 0 ? parts.join(', ') : 'All checks OK'}`
  const icon = (
    <span className="relative inline-flex">
      <HeartPulse />
      <span className="absolute -top-1 -right-1 inline-flex">
        <StatusDot state={dot} label={false} aria-hidden="true" />
      </span>
    </span>
  )
  // In the rail it is an item of the rail, so the arrow keys and the current mark treat it like the screens.
  if (tooltipPosition === 'right') return <Rail.Item label={label} icon={icon} current={active} onClick={() => openPlace('/health')} />
  return (
    <Tooltip text={label} position={tooltipPosition}>
      <Button svgOnly variant={active ? 'secondary' : 'tertiary'} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => openPlace('/health')}>
        {icon}
      </Button>
    </Tooltip>
  )
}

// The Health section, last on the Overview: one tile per item (download client, indexers, disks, the
// rest), failing first, each with its state as a status dot and a word, never colour alone. It shows
// its summary line alone while every check is ok, and opens when one fails; a click toggles it.
// The tiles are built in activity/health, which the Health tab of Activity shows in full.
import { Collapse, Skeleton } from '@hyprsh/design'
import { useState } from 'react'
import { useStatus } from '../api/attention'
import { HealthGroups } from '../activity/health/HealthGroups'
import { healthOf } from '../activity/health/tiles'

export function HealthStrip() {
  const status = useStatus()
  const s = status.data
  const [chosen, setChosen] = useState<boolean | null>(null)
  const health = s ? healthOf(s) : null
  const failing = health?.failing ?? 0
  // While the status loads the summary line is a Skeleton: the section is collapsed, so one inside it would be hidden.
  const summary = !health ? (
    <>
      {' '}
      <Skeleton width={64} height={16} className="inline-block align-middle" />
    </>
  ) : failing > 0 ? (
    ` · ${failing} failing`
  ) : (
    ' · all good'
  )
  return (
    <div>
      <Collapse size="small" headingLevel={2} title={<>Health{summary}</>} expanded={chosen ?? failing > 0} onChange={setChosen}>
        {health && (
          <div className="pt-3">
            <HealthGroups groups={health.groups} />
          </div>
        )}
      </Collapse>
    </div>
  )
}

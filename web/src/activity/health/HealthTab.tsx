// Activity's Health tab: every check from GET /system/status, grouped and failing first, with a summary
// line above. A failing check shows the action of its Needs attention row (the server builds those).
import { Button, Note } from '@hyprsh/design'
import { useAttention, useStatus, type AttentionRow } from '../../api/attention'
import { SkeletonRows } from '../../loading'
import { useAttentionAction } from '../../overview/useAttentionAction'
import { useOpenPlace } from '../../place'
import { clockTime } from '../../time'
import { HealthGroups } from './HealthGroups'
import type { TileData } from './HealthTile'
import { healthOf } from './tiles'

/** The first action of the row, or all of them: a Test, an Open Settings. */
function Actions({ row }: { row: AttentionRow }) {
  const openPlace = useOpenPlace()
  const { act, pending, error, dialog } = useAttentionAction(openPlace)
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {row.actions.map((a) => (
        <Button key={a.key} variant="secondary" size="small" disabled={pending} onClick={() => act(a)}>
          {a.label}
        </Button>
      ))}
      {error && <Note variant="error">{error.message}</Note>}
      {dialog}
    </div>
  )
}

export function HealthTab() {
  const status = useStatus()
  const rows = useAttention().data?.rows ?? []
  if (status.isPending) return <SkeletonRows count={4} />
  if (!status.data) return <Note variant="error">Health could not be loaded.</Note>
  const { groups, failing, ok } = healthOf(status.data)
  const checked = clockTime(new Date(status.dataUpdatedAt).toISOString())
  // A failing check's row is the one raised for its plugin instance.
  const actions = (t: TileData) => {
    const row = t.tone === 'failing' && t.instanceId != null ? rows.find((r) => r.subject.plugin_instance_id === t.instanceId && r.actions.length > 0) : undefined
    return row && <Actions row={row} />
  }
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
      <p className="label-12 text-gray-900">{failing > 0 ? `${failing} ${failing === 1 ? 'problem' : 'problems'} · ${ok} OK · checked ${checked}` : `All checks OK · checked ${checked}`}</p>
      <HealthGroups groups={groups} extra={actions} />
    </div>
  )
}

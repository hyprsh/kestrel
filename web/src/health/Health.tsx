// The Health screen: every check from GET /system/status, grouped and failing first, with a summary
// line above. A failing check shows the action of its Needs attention row (the server builds those).
import { Button, DotsMenu, MenuItem, Note } from '@hyprsh/design'
import { Clock, HeartPulse, Loader } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAttention, useStatus, type AttentionRow } from '../api/attention'
import { SkeletonRows } from '../loading'
import { useAttentionAction } from '../overview/useAttentionAction'
import { useJobs } from '../api/jobs'
import { currentPlace, useOpenPlace } from '../place'
import { clockTime } from '../time'
import { BackgroundJobs } from '../activity/BackgroundJobs'
import type { Running } from '../activity/running'
import { RunningNow } from '../activity/RunningNow'
import { useSearchAll } from '../activity/useSearchAll'
import { SectionBlock } from '../layout/SectionBlock'
import { SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
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

function HealthChecks() {
  const status = useStatus()
  const rows = useAttention().data?.rows ?? []
  if (status.isPending) return <SkeletonRows count={4} />
  if (!status.data) return <Note variant="error">Health could not be loaded.</Note>
  const { groups, failing, warnings, ok } = healthOf(status.data)
  const checked = clockTime(new Date(status.dataUpdatedAt).toISOString())
  // A failing check's row is the one raised for its plugin instance.
  const actions = (t: TileData) => {
    const row = t.tone === 'failing' && t.instanceId != null ? rows.find((r) => r.subject.plugin_instance_id === t.instanceId && r.actions.length > 0) : undefined
    return row && <Actions row={row} />
  }
  const counts = [failing > 0 && `${failing} ${failing === 1 ? 'problem' : 'problems'}`, warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${ok} OK`].filter(Boolean)
  const summary = failing + warnings > 0 ? `${counts.join(' · ')} · checked ${checked}` : `All checks OK · checked ${checked}`
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
      <p className="label-12 text-gray-900">{summary}</p>
      <HealthGroups groups={groups} extra={actions} />
    </div>
  )
}

type HealthView = 'checks' | 'running' | 'jobs'

/** The section a place opens: "/health/jobs" is the jobs, "/health/running" what runs now, else the checks. */
const viewOf = (section: string): HealthView => (section === 'jobs' || section === 'running' ? section : 'checks')

function HealthMenu() {
  const searchAll = useSearchAll()
  const status = useStatus()
  const attention = useAttention()
  return (
    <DotsMenu aria-label="Health actions" width={220}>
      <MenuItem
        disabled={status.isFetching}
        onSelect={() => {
          void status.refetch()
          void attention.refetch()
        }}
      >
        Run checks again
      </MenuItem>
      <MenuItem disabled={searchAll.blocked} onSelect={searchAll.run}>
        Search all Wanted
      </MenuItem>
    </DotsMenu>
  )
}

/** The panel's Views: Checks (with how many fail or warn), Running now and Background jobs. Choosing one scrolls to its section. */
function HealthViews({ running, current, onSelect }: { running: number; current: HealthView; onSelect: (view: HealthView) => void }) {
  const status = useStatus().data
  const jobs = useJobs().data?.items.length
  const { failing, warnings } = status ? healthOf(status) : { failing: 0, warnings: 0 }
  const problems = failing + warnings
  const checks = status === undefined ? undefined : <span className={failing > 0 ? 'text-red-900' : warnings > 0 ? 'text-amber-900' : undefined}>{problems}</span>
  return (
    <SidePanelViews>
      <SidePanelView icon={<HeartPulse />} count={checks} current={current === 'checks'} onSelect={() => onSelect('checks')}>
        Checks
      </SidePanelView>
      <SidePanelView icon={<Loader />} count={running} current={current === 'running'} onSelect={() => onSelect('running')}>
        Running now
      </SidePanelView>
      <SidePanelView icon={<Clock />} count={jobs} current={current === 'jobs'} onSelect={() => onSelect('jobs')}>
        Background jobs
      </SidePanelView>
    </SidePanelViews>
  )
}

/**
 * A SidePanel with the Views, and the sections as a centred column like the Overview's, so tiles do not stretch across a wide
 * window. The sections have ids so a place can scroll to them: "/health/checks", "/health/running" and "/health/jobs".
 * A phone shows no Views (the panel is its header); the three sections are stacked, so scrolling reaches them.
 */
export function Health({ running, onOpenAdoption, onOpenTitle }: { running: Running[]; onOpenAdoption: () => void; onOpenTitle: (id: number) => void }) {
  const [view, setView] = useState(() => viewOf(currentPlace().section))
  const show = (v: HealthView) => {
    setView(v)
    document.getElementById(`health-${v}`)?.scrollIntoView?.({ block: 'start' })
  }
  // A place that names a section (the Running indicator's "/health/jobs") opens scrolled to it.
  useEffect(() => {
    if (view !== 'checks') document.getElementById(`health-${view}`)?.scrollIntoView?.()
    // Only on arrival: later changes are the Views' own scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="flex min-h-0 flex-1 max-sm:flex-col">
      <SidePanel title="Health" actions={<HealthMenu />} views={<HealthViews running={running.length} current={view} onSelect={show} />} />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div role="region" aria-label="Health" className="mx-auto max-w-3xl pb-6 max-sm:px-4">
          <div id="health-checks">
            <SectionBlock title="Checks">
              <HealthChecks />
            </SectionBlock>
          </div>
          <div id="health-running">
            <RunningNow running={running} onOpenAdoption={onOpenAdoption} onOpenTitle={onOpenTitle} />
          </div>
          <div id="health-jobs">
            <BackgroundJobs onOpenTitle={onOpenTitle} />
          </div>
        </div>
      </div>
    </div>
  )
}

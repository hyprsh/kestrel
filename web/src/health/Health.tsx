// The Health screen: the verdict first, in words, then what runs now, the checks in groups and the background jobs. The
// side panel's Views jump between the three sections and its footer says the version, the uptime and how fresh the checks are.
import { Button, DotsMenu, MenuItem, NavItem, Note } from '@hyprsh/design'
import { Clock, HeartPulse, Loader } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAttention, useStatus } from '../api/attention'
import { useJobs, useRunJob } from '../api/jobs'
import { SkeletonRows } from '../loading'
import { currentPlace } from '../place'
import { ago, span, useNow } from '../time'
import { useReport } from '../toasts'
import { BackgroundJobs } from '../activity/BackgroundJobs'
import type { Running } from '../activity/running'
import { RunningNow } from '../activity/RunningNow'
import { useSearchAll } from '../activity/useSearchAll'
import { PanelContent, SidePanel, SidePanelViews } from '../layout/SidePanel'
import { HealthGroups } from './HealthGroups'
import { healthOf } from './tiles'
import { Verdict } from './Verdict'
import { useVerdict } from './problems'

/** Runs the Health loop, which checks everything again; when its pass ends the status and the rows are read again. */
function useRunChecks() {
  const status = useStatus()
  const attention = useAttention()
  const run = useRunJob()
  const report = useReport()
  const ran = useJobs().data?.items.find((j) => j.name === 'health')?.last_run?.finished_at
  const seen = useRef(ran)
  useEffect(() => {
    if (ran === seen.current) return
    seen.current = ran
    void status.refetch()
    void attention.refetch()
    // Only a new pass of the loop reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ran])
  return {
    pending: run.isPending,
    run: () => void report(run.mutateAsync('health'), { failed: 'Could not run the checks' }),
  }
}

/** The Checks section: "10 ok · 1 failing" and Run Checks Again over the tiles in their groups. */
function HealthChecks() {
  const status = useStatus()
  const checks = useRunChecks()
  const title = useId()
  let body
  let counts: string | null = null
  if (status.isPending) body = <SkeletonRows count={4} />
  else if (!status.data) body = <Note variant="error">Health could not be loaded.</Note>
  else {
    const { groups, failing, warnings, ok } = healthOf(status.data)
    counts = [`${ok} ok`, `${failing} failing`, warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(' · ')
    body = <HealthGroups groups={groups} />
  }
  return (
    <section aria-labelledby={title} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 id={title} className="heading-16 flex-1">
          Checks
        </h3>
        {counts && <span className="label-13 text-gray-900 max-sm:order-last max-sm:basis-full">{counts}</span>}
        <Button variant="tertiary" size="small" loading={checks.pending} onClick={checks.run} className="shrink-0 whitespace-nowrap">
          Run Checks Again
        </Button>
      </div>
      {body}
    </section>
  )
}

type HealthView = 'checks' | 'running' | 'jobs'

/** The section a place opens: "/health/jobs" is the jobs, "/health/checks" the checks, else what runs now (the top). */
const viewOf = (section: string): HealthView => (section === 'jobs' || section === 'checks' ? section : 'running')

function HealthMenu() {
  const searchAll = useSearchAll()
  const checks = useRunChecks()
  return (
    <DotsMenu aria-label="Health actions" width={220}>
      <MenuItem disabled={checks.pending} onSelect={checks.run}>
        Run checks again
      </MenuItem>
      <MenuItem disabled={searchAll.blocked} onSelect={searchAll.run}>
        Search all Wanted
      </MenuItem>
    </DotsMenu>
  )
}

/** The panel's Views: Running now, Checks (with how many fail or warn) and Background jobs. Choosing one scrolls to its section. */
function HealthViews({ running, current, onSelect }: { running: number; current: HealthView; onSelect: (view: HealthView) => void }) {
  const status = useStatus().data
  const jobs = useJobs().data?.items.length
  const { failing, warnings } = status ? healthOf(status) : { failing: 0, warnings: 0 }
  const problems = failing + warnings
  // Nothing is counted while nothing is wrong: an OK count is noise beside Running now and Background jobs.
  const checks =
    status === undefined || problems === 0 ? undefined : (
      <span data-tone={failing > 0 ? 'failing' : 'warning'} className={`label-12 tabular-nums ${failing > 0 ? 'text-red-900' : 'text-amber-900'}`}>
        {problems}
      </span>
    )
  return (
    <SidePanelViews>
      <NavItem icon={<Loader />} trailing={running} current={current === 'running' ? 'true' : false} onClick={() => onSelect('running')}>
        Running now
      </NavItem>
      <NavItem icon={<HeartPulse />} trailing={checks} trailingLabel={problems > 0 ? String(problems) : undefined} current={current === 'checks' ? 'true' : false} onClick={() => onSelect('checks')}>
        Checks
      </NavItem>
      <NavItem icon={<Clock />} trailing={jobs} current={current === 'jobs' ? 'true' : false} onClick={() => onSelect('jobs')}>
        Background jobs
      </NavItem>
    </SidePanelViews>
  )
}

/** "Kestrel 1.8.2 · up 6 d 4 h · checked 1 min ago", in the panel's footer; nothing until the status is known. */
function HealthFooter() {
  const status = useStatus()
  const now = useNow()
  if (!status.data) return null
  const { version, started_at } = status.data
  const parts = [`Kestrel ${version}`, `up ${span(now - Date.parse(started_at))}`, `checked ${ago(new Date(status.dataUpdatedAt).toISOString(), now)}`]
  return <span>{parts.join(' · ')}</span>
}

/** The verdict at the top of the content: what is wrong and where it gets fixed, or "All good". */
function HealthVerdict() {
  const { problems, ready } = useVerdict()
  const status = useStatus().data
  if (!ready || !status) return null
  const { failing, warnings, ok } = healthOf(status)
  // The one problem is all that is wrong when nothing else fails or warns.
  return <Verdict problems={problems} checks={ok + failing + warnings} restFine={failing + warnings <= 1} />
}

/**
 * A SidePanel with the Views, and the sections as a centred column like the Overview's, so tiles do not stretch across a wide
 * window. The sections have ids so a place can scroll to them: "/health/checks", "/health/running" and "/health/jobs".
 * A phone shows no Views (the panel is its header); the sections are stacked, so scrolling reaches them.
 */
export function Health({ running, onOpenAdoption, onOpenTitle }: { running: Running[]; onOpenAdoption: () => void; onOpenTitle: (id: number) => void }) {
  const [view, setView] = useState(() => viewOf(currentPlace().section))
  const show = (v: HealthView) => {
    setView(v)
    document.getElementById(`health-${v}`)?.scrollIntoView?.({ block: 'start' })
  }
  // A place that names a section (the Running indicator's "/health/jobs") opens scrolled to it.
  useEffect(() => {
    if (currentPlace().section) document.getElementById(`health-${view}`)?.scrollIntoView?.()
    // Only on arrival: later changes are the Views' own scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="flex min-h-0 flex-1 max-sm:flex-col">
      <SidePanel title="Health" actions={<HealthMenu />} views={<HealthViews running={running.length} current={view} onSelect={show} />} footer={<HealthFooter />} />
      <PanelContent reading>
        <div role="region" aria-label="Health" className="flex flex-col gap-6">
          <HealthVerdict />
          <div id="health-running">
            <RunningNow running={running} onOpenAdoption={onOpenAdoption} onOpenTitle={onOpenTitle} />
          </div>
          <div id="health-checks">
            <HealthChecks />
          </div>
          <div id="health-jobs">
            <BackgroundJobs onOpenTitle={onOpenTitle} />
          </div>
        </div>
      </PanelContent>
    </div>
  )
}

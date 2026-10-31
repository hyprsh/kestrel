// The Activity screen in three tabs, each with its own address (see tabs.ts): Grabs, every Grab from
// search to Import; Health, every check Kestrel runs; Background Jobs, the work running now and the
// job schedule. The Grabs filter is the screen's `?q=`: "/activity?q=stage:done" opens it on the Done
// stage. The tabs are the design's Tabs; the Shell owns the address, so a click is handed to it.
import { Badge, StatusDot, Tabs } from '@hyprsh/design'
import type { MouseEvent } from 'react'
import { useQueue } from '../api/queue'
import { useStalledGrabs } from '../api/activity'
import { BackgroundJobs } from './BackgroundJobs'
import { HealthTab } from './health/HealthTab'
import { useFailingChecks } from './health/useFailingChecks'
import { Pipeline } from './Pipeline'
import type { Running } from './running'
import { RunningNow } from './RunningNow'
import { activityTabs, activityTabSection, type ActivityTab } from './tabs'

const Count = ({ n }: { n: number }) => (
  <>
    {' '}
    <Badge variant="gray" contrast="low" size="sm">
      {n}
    </Badge>
  </>
)

/**
 * `query` is the Grabs filter text, kept by the Shell so it can live in the address bar; `tab` is the
 * tab shown and `onTab` is told of a click on another; `running` is the work running now, which the
 * Shell's top bar shows too.
 */
export function Activity({
  tab,
  onTab,
  query,
  onQuery,
  onOpenTitle,
  running,
  onOpenAdoption,
}: {
  tab: ActivityTab
  onTab: (tab: ActivityTab) => void
  query: string
  onQuery: (query: string) => void
  onOpenTitle: (id: number) => void
  running: Running[]
  onOpenAdoption: () => void
}) {
  const active = (useQueue().data?.length ?? 0) + (useStalledGrabs().data?.length ?? 0)
  const failing = useFailingChecks()
  const titles: Record<ActivityTab, React.ReactNode> = {
    grabs: <>Grabs{active > 0 && <Count n={active} />}</>,
    health: (
      <>
        Health
        {failing > 0 && (
          <>
            {' '}
            <StatusDot state="error" label="failing" />
          </>
        )}
      </>
    ),
    jobs: <>Background Jobs{running.length > 0 && <Count n={running.length} />}</>,
  }
  const content: Record<ActivityTab, React.ReactNode> = {
    grabs: <Pipeline query={query} onQuery={onQuery} onOpenTitle={onOpenTitle} />,
    health: <HealthTab />,
    jobs: (
      <>
        <RunningNow running={running} onOpenAdoption={onOpenAdoption} onOpenTitle={onOpenTitle} />
        <BackgroundJobs />
      </>
    ),
  }
  // The tabs are buttons, so a Cmd/Ctrl/Shift-click is turned into the new tab or window a link would open.
  const aside = (e: MouseEvent) => {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return
    const tabs = [...e.currentTarget.querySelectorAll('[role="tab"]')]
    const i = tabs.findIndex((t) => t.contains(e.target as Node))
    if (i < 0) return
    e.preventDefault()
    e.stopPropagation()
    const section = activityTabSection(activityTabs[i].value)
    window.open(new URL(`activity${section ? `/${section}` : ''}${activityTabs[i].value === 'grabs' && query ? `?${new URLSearchParams({ q: query })}` : ''}`, document.baseURI), '_blank', 'noopener')
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* A centred column like the Overview's, so rows and progress bars do not stretch across a wide window. */}
      <div className="mx-auto max-w-3xl pb-6" onClickCapture={aside}>
        <Tabs aria-label="Activity" selected={tab} onChange={(v) => onTab(v as ActivityTab)} tabs={activityTabs.map((t) => ({ value: t.value, title: titles[t.value], content: content[t.value] }))} />
      </div>
    </div>
  )
}

// The Activity screen in three views, each with its own address (see tabs.ts): Grabs, every Grab from
// search to Import; Health, every check Kestrel runs; Background Jobs, the work running now and the
// job schedule. The Grabs filter is the screen's `?q=`: "/activity?q=stage:done" opens it on the Done
// stage. The screen bar's view switcher picks the view; the Shell owns the address, so a pick is handed to it.
import { Badge, Skeleton, StatusDot } from '@hyprsh/design'
import { useQueue } from '../api/queue'
import { useStalledGrabs } from '../api/activity'
import { BackgroundJobs } from './BackgroundJobs'
import { HealthTab } from './health/HealthTab'
import { useHealthCounts } from './health/useHealthCounts'
import { FilterBar } from '../filter/FilterBar'
import { FacetFilterButton } from '../layout/FilterButton'
import { ScreenBar, ScreenCount, ViewSwitcher } from '../layout/ScreenBar'
import { activityQualifiers } from './filter'
import { Pipeline, usePipeline } from './Pipeline'
import type { Stage } from './stages'
import type { Running } from './running'
import { RunningNow } from './RunningNow'
import { activityTabs, type ActivityTab } from './tabs'

const Count = ({ n }: { n: number }) => (
  <>
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
  const { failing, warnings } = useHealthCounts()
  const pipeline = usePipeline(query)
  const hints: Record<ActivityTab, React.ReactNode> = {
    grabs: active > 0 ? <Count n={active} /> : undefined,
    health: failing + warnings > 0 ? failing > 0 ? <StatusDot state="error" label="failing" /> : <StatusDot state="warning" label="warning" /> : undefined,
    jobs: running.length > 0 ? <Count n={running.length} /> : undefined,
  }
  const content: Record<ActivityTab, React.ReactNode> = {
    grabs: <Pipeline data={pipeline} onOpenTitle={onOpenTitle} />,
    health: <HealthTab />,
    jobs: (
      <>
        <RunningNow running={running} onOpenAdoption={onOpenAdoption} onOpenTitle={onOpenTitle} />
        <BackgroundJobs />
      </>
    ),
  }
  const tabLabel: Record<ActivityTab, string> = { grabs: 'Grabs', health: 'Health', jobs: 'Background Jobs' }
  const grabs = tab === 'grabs'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenBar
        view={<ViewSwitcher label="Activity" current={tab} onChange={onTab} views={activityTabs.map((t) => ({ value: t.value, label: tabLabel[t.value], hint: hints[t.value] }))} />}
        filter={
          grabs ? (
            <FilterBar
              id="activity-filter"
              label="Filter Activity"
              placeholder="Filter, e.g. stage:failed kind:series slot:4k …  /"
              value={query}
              onChange={onQuery}
              qualifiers={activityQualifiers}
              menus={false}
            />
          ) : undefined
        }
        controls={
          grabs ? (
            <FacetFilterButton
              query={query}
              onQuery={onQuery}
              qualifiers={activityQualifiers}
              suffix={(name, value) => (name === 'stage' ? <span className="tabular-nums">{pipeline.count(value as Stage)}</span> : null)}
            />
          ) : undefined
        }
        count={grabs ? <ScreenCount>{pipeline.pending ? <Skeleton width={48} height={14} /> : `${pipeline.rows.length} of ${pipeline.total}`}</ScreenCount> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {/* A centred column like the Overview's, so rows and progress bars do not stretch across a wide window. */}
        {/* The view's page, named for the view the switcher shows. */}
        <div role="tabpanel" aria-label={tabLabel[tab]} className="mx-auto max-w-3xl pb-6 max-sm:px-4">
          {content[tab]}
        </div>
      </div>
    </div>
  )
}

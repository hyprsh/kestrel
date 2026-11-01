// The Activity screen: every Grab from search to Import, grouped by stage. The filter is the screen's `?q=`:
// "/activity?q=stage:done" opens it on the Done stage. The Shell owns the filter text, so a change is handed to it.
// The side panel holds the filter and the Views, which are presets of the `stage:` term; the Pipeline fills the rest.
// The background jobs and what runs now moved to the Health screen.
import { DotsMenu, MenuItem, MenuSection, parseQuery, termText, valuesOf, withoutValue } from '@hyprsh/design'
import { ArrowDownToLine, CircleAlert, FileCheck, List, Search } from 'lucide-react'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import { FacetFilterButton } from '../layout/FilterButton'
import { FilterChips, SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
import { useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { activityQualifiers } from './filter'
import { Pipeline, usePipeline, type PipelineData } from './Pipeline'
import type { Stage } from './stages'
import { useSearchAll } from './useSearchAll'

/** A Views row: the stages it shows (none is every stage). Queued and Post-processing are part of Downloading, Stalled part of Importing. */
const views: { key: string; label: string; stages: readonly Stage[]; icon: React.ReactNode; tone?: 'red' }[] = [
  { key: 'all', label: 'All', stages: [], icon: <List /> },
  { key: 'downloading', label: 'Downloading', stages: ['queued', 'downloading', 'processing'], icon: <ArrowDownToLine /> },
  { key: 'searching', label: 'Searching', stages: ['searching'], icon: <Search /> },
  { key: 'importing', label: 'Importing', stages: ['importing', 'stalled'], icon: <FileCheck /> },
  { key: 'done', label: 'Done', stages: ['done'], icon: <FileCheck /> },
  { key: 'failed', label: 'Failed', stages: ['failed'], icon: <CircleAlert />, tone: 'red' },
]

/** The query with its `stage:` terms replaced by the view's. */
function withStages(query: string, stages: readonly Stage[]): string {
  let text = query
  for (const v of valuesOf(parseQuery(query, activityQualifiers), 'stage') ?? []) text = withoutValue(text, 'stage', v, activityQualifiers)
  text = text.trim()
  return stages.length === 0 ? text : `${text} ${termText({ name: 'stage', values: [...stages], excluded: false })}`.trim()
}

/** The Views row `query` is on: the one whose stages are exactly the query's `stage:` values. */
function currentView(query: string): string | null {
  const chosen = valuesOf(parseQuery(query, activityQualifiers), 'stage') ?? []
  return views.find((v) => v.stages.length === chosen.length && v.stages.every((s) => chosen.includes(s)))?.key ?? null
}

const viewCount = (v: (typeof views)[number], pipeline: PipelineData) => (v.stages.length === 0 ? pipeline.total : v.stages.reduce((sum, s) => sum + pipeline.count(s), 0))

/** The Views as the first section of a phone's Filter menu, where the panel's own Views are hidden. */
function ViewsSection({ query, onQuery, pipeline }: { query: string; onQuery: (query: string) => void; pipeline: PipelineData }) {
  const current = currentView(query)
  return (
    <MenuSection title="Views">
      {views.map((v) => (
        <MenuItem key={v.key} checked={current === v.key} suffix={<span className="tabular-nums">{viewCount(v, pipeline)}</span>} onSelect={() => onQuery(withStages(query, v.stages))}>
          {v.label}
        </MenuItem>
      ))}
    </MenuSection>
  )
}

function ActivityViews({ query, onQuery, pipeline }: { query: string; onQuery: (query: string) => void; pipeline: PipelineData }) {
  const current = currentView(query)
  return (
    <SidePanelViews>
      {views.map((v) => {
        const n = viewCount(v, pipeline)
        return (
          <SidePanelView
            key={v.key}
            icon={v.icon}
            count={v.tone === 'red' && n > 0 ? <span className="text-red-900">{n}</span> : n}
            current={current === v.key}
            onSelect={() => onQuery(withStages(query, v.stages))}
          >
            {v.label}
          </SidePanelView>
        )
      })}
    </SidePanelViews>
  )
}

function ActivityMenu() {
  const searchAll = useSearchAll()
  const openPlace = useOpenPlace()
  return (
    <DotsMenu aria-label="Activity actions" width={220}>
      <MenuItem disabled={searchAll.blocked} onSelect={searchAll.run}>
        Search all Wanted
      </MenuItem>
      <MenuItem onSelect={() => openPlace('/health/jobs')}>Background jobs</MenuItem>
    </DotsMenu>
  )
}

/** The footer line: how many Grabs there are and how far back the history goes, "12 Grabs · since 3 Mar 2026". */
function footer(total: number, oldest: string | null): string {
  const n = total === 1 ? '1 Grab' : `${total} Grabs`
  return oldest ? `${n} · since ${new Date(oldest).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : n
}

/** `query` is the Grabs filter text, kept by the Shell so it can live in the address bar. */
export function Activity({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const pipeline = usePipeline(query)
  const phone = usePhone()
  const panel = {
    title: 'Activity',
    actions: <ActivityMenu />,
    filter: <FilterBar id="activity-filter" label="Filter Activity" placeholder="Filter grabs, e.g. stage:failed  /" value={query} onChange={onQuery} qualifiers={activityQualifiers} menus={false} />,
    controls: <FacetFilterButton query={query} onQuery={onQuery} qualifiers={activityQualifiers} lead={phone ? <ViewsSection query={query} onQuery={onQuery} pipeline={pipeline} /> : undefined} />,
    chips: <FilterChips chips={filterChips(query, onQuery, activityQualifiers)} />,
    views: <ActivityViews query={query} onQuery={onQuery} pipeline={pipeline} />,
    footer: <span>{footer(pipeline.total, pipeline.oldest)}</span>,
  }
  return (
    <div className="flex min-h-0 flex-1 max-sm:flex-col">
      <SidePanel {...panel} />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {/* A centred column like the Overview's, so rows and progress bars do not stretch across a wide window. */}
        <div className="mx-auto max-w-3xl pb-6 max-sm:px-4">
          <Pipeline data={pipeline} onOpenTitle={onOpenTitle} />
        </div>
      </div>
    </div>
  )
}

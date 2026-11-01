// The Activity screen: what moves now (In progress) above what ended (History). The filter is the screen's `?q=`:
// "/activity?q=stage:done" opens it on the Imported view. The Shell owns the filter text, so a change is handed to it.
// The side panel holds the filter and the Views, which are presets of the `stage:` term; the Pipeline fills the rest.
// The background jobs and what runs now moved to the Health screen.
import { DotsMenu, MenuItem, MenuSection, parseQuery, termText, valuesOf, withoutValue } from '@hyprsh/design'
import { CircleCheck, CircleX, List, Loader } from 'lucide-react'
import { useState } from 'react'
import { FilterBar } from '../filter/FilterBar'
import { filterChips } from '../filter/chips'
import { FacetFilterButton } from '../layout/FilterButton'
import { FilterChips, PanelContent, SidePanel, SidePanelView, SidePanelViews } from '../layout/SidePanel'
import type { GrabEntry } from '../api/activity'
import { useProfiles, useTitle } from '../api/queries'
import { ManualSearch } from '../library/ManualSearch'
import { slotLabel, type SlotKey } from '../library/bits'
import { useOpenPlace } from '../place'
import { usePhone } from '../responsive'
import { activityQualifiers } from './filter'
import { Pipeline, usePipeline, type PipelineData } from './Pipeline'
import type { Stage } from './stages'
import { useSearchAll } from './useSearchAll'

/** A Views row: the stages it shows (none is every stage). In progress is the search pass and every Grab that has not ended. */
const views: { key: string; label: string; stages: readonly Stage[]; icon: React.ReactNode; tone?: 'red' }[] = [
  { key: 'all', label: 'Everything', stages: [], icon: <List /> },
  { key: 'progress', label: 'In progress', stages: ['searching', 'queued', 'downloading', 'processing', 'importing', 'stalled'], icon: <Loader /> },
  { key: 'imported', label: 'Imported', stages: ['done'], icon: <CircleCheck /> },
  { key: 'failed', label: 'Failed', stages: ['failed'], icon: <CircleX />, tone: 'red' },
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

/** The footer line: how many Grabs there are and how far back the history goes, "12 Grabs · since Mar 3, 2026". */
function footer(total: number, oldest: string | null): string {
  const n = total === 1 ? '1 Grab' : `${total} Grabs`
  return oldest ? `${n} · since ${new Date(oldest).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : n
}

/** `query` is the Grabs filter text, kept by the Shell so it can live in the address bar. */
export function Activity({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const pipeline = usePipeline(query)
  const phone = usePhone()
  const [manual, setManual] = useState<GrabEntry | null>(null)
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
      {manual ? (
        <ManualSearchOf grab={manual} onBack={() => setManual(null)} />
      ) : (
        <PanelContent reading>
          <Pipeline data={pipeline} onOpenTitle={onOpenTitle} onManualSearch={setManual} />
        </PanelContent>
      )}
    </div>
  )
}

/** Manual search for the Version of a failed Grab, in place of the lists until Back. */
function ManualSearchOf({ grab: g, onBack }: { grab: GrabEntry; onBack: () => void }) {
  const title = useTitle(g.title_id).data
  const profiles = useProfiles().data
  const version = title?.versions.find((v) => v.id === g.version_id)
  const profile = profiles?.find((p) => p.key === version?.profile)
  return (
    <ManualSearch
      titleName={g.title}
      slotLabel={g.slot ? slotLabel[g.slot as SlotKey] : ''}
      profileName={profile?.name ?? version?.profile ?? ''}
      versionId={g.version_id!}
      scope={undefined}
      onBack={onBack}
    />
  )
}

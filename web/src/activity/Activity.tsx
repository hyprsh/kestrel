// The Activity screen: every Grab from search to Import, grouped by stage. The filter is the screen's `?q=`:
// "/activity?q=stage:done" opens it on the Done stage. The Shell owns the filter text, so a change is handed to it.
// The background jobs and what runs now moved to the Health screen.
import { FilterBar } from '../filter/FilterBar'
import { FacetFilterButton } from '../layout/FilterButton'
import { ScreenBar } from '../layout/ScreenBar'
import { activityQualifiers } from './filter'
import { Pipeline, usePipeline } from './Pipeline'
import type { Stage } from './stages'

/** `query` is the Grabs filter text, kept by the Shell so it can live in the address bar. */
export function Activity({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  const pipeline = usePipeline(query)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenBar
        filter={
          <FilterBar id="activity-filter" label="Filter Activity" placeholder="Filter grabs, e.g. stage:failed  /" value={query} onChange={onQuery} qualifiers={activityQualifiers} menus={false} />
        }
        controls={
          <FacetFilterButton
            query={query}
            onQuery={onQuery}
            qualifiers={activityQualifiers}
            suffix={(name, value) => (name === 'stage' ? <span className="tabular-nums">{pipeline.count(value as Stage)}</span> : null)}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {/* A centred column like the Overview's, so rows and progress bars do not stretch across a wide window. */}
        <div className="mx-auto max-w-3xl pb-6 max-sm:px-4">
          <Pipeline data={pipeline} onOpenTitle={onOpenTitle} />
        </div>
      </div>
    </div>
  )
}

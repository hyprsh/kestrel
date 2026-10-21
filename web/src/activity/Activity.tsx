// The Activity screen: every Grab from search to Import, and (with later sections) the
// background work Kestrel is doing right now. One scrolling column of sections, each its own
// file in activity/ with an element id `activity-<section>`, so a place such as
// "/activity/running" scrolls to it (Shell's goPath). The pipeline's filter is the screen's
// `?q=`: "/activity?q=stage:done" opens it on the Done stage.
import { Pipeline } from './Pipeline'

/** `query` is the pipeline's filter text, kept by the Shell so it can live in the address bar. */
export function Activity({ query, onQuery, onOpenTitle }: { query: string; onQuery: (query: string) => void; onOpenTitle: (id: number) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* "Running now" (activity-running) goes above the pipeline, "Background jobs" (activity-jobs) below it. */}
      <Pipeline query={query} onQuery={onQuery} onOpenTitle={onOpenTitle} />
    </div>
  )
}

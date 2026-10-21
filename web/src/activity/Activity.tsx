// The Activity screen: every Grab from search to Import, and (with later sections) the
// background work Kestrel is doing right now. One scrolling column of sections, each its own
// file in activity/ with an element id `activity-<section>`, so a place such as
// "/activity/running" scrolls to it (Shell's goPath). The pipeline's filter is the screen's
// `?q=`: "/activity?q=stage:done" opens it on the Done stage.
import { BackgroundJobs } from './BackgroundJobs'
import { Pipeline } from './Pipeline'
import type { Running } from './running'
import { RunningNow } from './RunningNow'

/**
 * `query` is the pipeline's filter text, kept by the Shell so it can live in the address bar;
 * `running` is the work running now, which the Shell's top bar shows too.
 */
export function Activity({
  query,
  onQuery,
  onOpenTitle,
  running,
  onOpenAdoption,
}: {
  query: string
  onQuery: (query: string) => void
  onOpenTitle: (id: number) => void
  running: Running[]
  onOpenAdoption: () => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <RunningNow running={running} onOpenAdoption={onOpenAdoption} onOpenTitle={onOpenTitle} />
      <Pipeline query={query} onQuery={onQuery} onOpenTitle={onOpenTitle} />
      <BackgroundJobs />
    </div>
  )
}

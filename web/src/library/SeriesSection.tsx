import { ApiError, useEpisodes, useSetSeriesMonitor, type Episode, type SeriesMonitor, type TitleDetail } from '../api/queries'
import { ErrorText, Select } from '../forms'
import { slotKeys } from './bits'
import { EpisodeToolbar, useEpisodeActions } from './EpisodeActions'
import { EpisodeMatrix } from './EpisodeMatrix'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/** What a Series adds to its detail pane: the monitoring mode and the episodes × Slots heat map. */
export function SeriesSection({ title, onManualSearch }: { title: TitleDetail; onManualSearch?: (t: ManualSearchTarget) => void }) {
  const setMode = useSetSeriesMonitor(title.id)
  const slots = slotKeys.filter((k) => title.versions.some((v) => v.slot === k))
  const episodes = useEpisodes(title.id).data ?? noEpisodes
  const actions = useEpisodeActions(title, episodes, slots, onManualSearch)
  return (
    <section aria-label="Episodes" className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[13px] font-semibold">Episodes</h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-gray-900">
          Monitor
          <Select
            aria-label="Monitor"
            value={title.series_monitor ?? 'all'}
            disabled={setMode.isPending}
            onChange={(e) => setMode.mutate(e.target.value as SeriesMonitor)}
            className="w-44"
          >
            <option value="all">All episodes</option>
            <option value="future">Future episodes only</option>
            <option value="none">None</option>
          </Select>
        </label>
      </div>
      {setMode.isError && <ErrorText>{setMode.error instanceof ApiError ? setMode.error.message : 'Could not change monitoring.'}</ErrorText>}
      <EpisodeToolbar actions={actions} episodes={episodes} />
      <EpisodeMatrix titleId={title.id} slots={slots} actions={actions} />
    </section>
  )
}

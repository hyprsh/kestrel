import { useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { slotKeys } from './bits'
import { EpisodeToolbar, useEpisodeActions } from './EpisodeActions'
import { EpisodeMatrix } from './EpisodeMatrix'
import { SeasonToolbar } from './SeasonSummary'
import type { ManualSearchTarget } from './TitleDetail'
import { useSeasonOpen } from './useSeasonOpen'

const noEpisodes: Episode[] = []

/** What a Series adds to its detail pane: the episodes × Slots heat map. */
export function SeriesSection({ title, onManualSearch }: { title: TitleDetail; onManualSearch?: (t: ManualSearchTarget) => void }) {
  const seasons = useSeasonOpen(title.id)
  const slots = slotKeys.filter((k) => title.versions.some((v) => v.slot === k))
  const episodes = useEpisodes(title.id).data ?? noEpisodes
  const actions = useEpisodeActions(title, episodes, seasons, slots, onManualSearch)
  return (
    <section aria-label="Episodes" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="heading-14">Episodes</h3>
        <SeasonToolbar seasons={seasons} />
      </div>
      <EpisodeToolbar actions={actions} />
      <EpisodeMatrix titleId={title.id} slots={slots} seasons={seasons} actions={actions} />
    </section>
  )
}

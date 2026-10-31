import { Note, Skeleton } from '@hyprsh/design'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { ApiError, useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { useColumnWidths } from '../layout/columnWidths'
import { ViewSwitcher } from '../layout/ScreenBar'
import { LoadingRegion } from '../loading'
import { slotKeys } from './bits'
import { SeasonButtons, SeasonDeleteConfirm, TickedBar, useEpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeMatrix } from './EpisodeMatrix'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeason, episodeCode, orderEpisodes, orderSeasons, seasonName, seasonStanding } from './episodes'
import { grabsByEpisode } from './cellDetail'
import { SeasonCount, SeasonSummary } from './SeasonSummary'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/**
 * What a Series adds to its Title page: one toolbar row (a season menu with the season's summary, a "Find an episode" field,
 * Search season and a ⋯ menu), the episodes × Slots table and, while episodes are ticked, their floating bar. The open
 * season and the found episode live in the address bar (episodeView.ts).
 */
export function SeriesSection({ title, onManualSearch }: { title: TitleDetail; onManualSearch?: (t: ManualSearchTarget) => void }) {
  const slots = slotKeys.filter((k) => title.versions.some((v) => v.slot === k))
  const { display, ready } = useDisplay()
  const query = useEpisodes(title.id)
  const loaded = query.data
  const episodes = useMemo(() => (loaded ? orderEpisodes(loaded, display.season_order) : noEpisodes), [loaded, display.season_order])
  const grouped = useMemo(() => bySeason(episodes), [episodes])
  const seasons = useMemo(() => orderSeasons([...grouped.keys()], display.season_order), [grouped, display.season_order])
  const view = useEpisodeView(title.id)
  const columns = useColumnWidths('episodes')
  const queue = useQueue()
  const grabs = useMemo(() => grabsByEpisode(queue.data, title.id), [queue.data, title.id])
  const season = view.season !== null && grouped.has(view.season) ? view.season : defaultSeason(seasons)
  const shown = grouped.get(season) ?? noEpisodes
  const actions = useEpisodeActions(title, episodes, shown, slots, onManualSearch)

  // The Find field: a code or part of a name goes to that episode's season and highlights it.
  const found = view.episode === null ? null : (shown.find((e) => e.number === view.episode)?.id ?? null)
  const find = useEpisodeFind(
    episodes,
    (hit) => (hit ? view.set(hit.season, hit.number) : view.set(view.season, null)),
    view.season !== null && view.episode !== null ? `S${String(view.season).padStart(2, '0')}E${String(view.episode).padStart(2, '0')}` : '',
  )
  // Another Series starts with an empty field.
  const [fieldFor, setFieldFor] = useState(title.id)
  useEffect(() => {
    if (fieldFor === title.id) return
    setFieldFor(title.id)
    find.setText('')
    find.setAt(0)
  }, [fieldFor, title.id, find])
  // Episodes loading after the address named one: the field shows it.
  const code = found === null ? '' : episodeCode(shown.find((e) => e.id === found)!)
  useEffect(() => {
    if (code && find.text === '') find.setText(code)
  }, [code, find])

  if (query.isError) {
    return (
      <Section>
        <Note variant="error" size="small">
          {query.error instanceof ApiError ? query.error.message : 'Could not load the episodes.'}
        </Note>
      </Section>
    )
  }
  if (!loaded || !ready) return <EpisodesSkeleton />
  if (episodes.length === 0) {
    return (
      <Section>
        <p className="copy-13 text-gray-900">TheTVDB lists no episodes yet.</p>
      </Section>
    )
  }

  const standing = seasonStanding(shown, slots)
  return (
    <Section
      bar={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:basis-full">
            <ViewSwitcher
              label="Seasons"
              current={String(season)}
              onChange={(v) => view.set(Number(v), null)}
              views={seasons.map((s) => {
                const st = seasonStanding(grouped.get(s) ?? noEpisodes, slots)
                return { value: String(s), label: seasonName(s), hint: <SeasonCount standing={st} /> }
              })}
            />
            <SeasonSummary standing={standing} />
          </div>
          <div className="flex items-center gap-2 max-sm:basis-full">
            <div className="w-56 max-sm:w-0 max-sm:flex-1">
              <FindEpisodeField find={find} />
            </div>
            <SeasonButtons actions={actions} season={season} episodes={shown} columns={columns} />
          </div>
        </>
      }
    >
      <SeasonDeleteConfirm actions={actions} season={season} />
      <EpisodeMatrix season={season} episodes={shown} slots={slots} actions={actions} found={found} grabs={grabs} columnWidths={columns} />
      <TickedBar actions={actions} />
    </Section>
  )
}

/** The Episodes heading and, on its row, the season toolbar (`bar`): it wraps as whole groups, never word by word. */
function Section({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label="Episodes" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="heading-14 max-sm:basis-full">Episodes</h3>
        {bar}
      </div>
      {children}
    </section>
  )
}

/** The section while the episodes load: tabs and rows in the shape of the real ones. */
function EpisodesSkeleton() {
  return (
    <Section>
      <LoadingRegion label="Loading episodes">
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton width="60%" height={32} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={`${70 + ((i * 13) % 30)}%`} height={24} />
          ))}
        </div>
      </LoadingRegion>
    </Section>
  )
}

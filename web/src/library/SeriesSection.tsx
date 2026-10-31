import { Note, Skeleton, Tabs } from '@hyprsh/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { ResetColumnWidths, useColumnWidths } from '../layout/columnWidths'
import { LoadingRegion } from '../loading'
import { slotKeys } from './bits'
import { SeasonButtons, SeasonDeleteConfirm, TickedBar, useEpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeMatrix } from './EpisodeMatrix'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeason, episodeCode, orderEpisodes, orderSeasons, seasonName, seasonStanding } from './episodes'
import { SeasonSummary, TabCount } from './SeasonSummary'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/**
 * What a Series adds to its Title page: a tab per season and Specials with the season's summary and buttons, its
 * episodes × Slots table, a "Find an episode" field and, while episodes are ticked, their floating bar. The open
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
  const tabs = useRef<HTMLDivElement>(null)
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

  // The open tab stays in view on a row of tabs that scrolls (a phone): the nearest ancestor that overflows scrolls to it.
  useEffect(() => {
    const open = tabs.current?.querySelector('[aria-selected="true"]')
    let row = open?.parentElement ?? null
    while (row && row.scrollWidth <= row.clientWidth && row !== tabs.current) row = row.parentElement
    if (!open || !row) return
    const at = open.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    row.scrollLeft += at.left - box.left - (box.width - at.width) / 2
  }, [season, loaded])

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

  return (
    <Section>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div ref={tabs} className="max-w-full overflow-x-auto">
          <Tabs
            aria-label="Seasons"
            selected={String(season)}
            onChange={(v) => view.set(Number(v), null)}
            tabs={seasons.map((s) => ({
              value: String(s),
              title: (
                <>
                  {seasonName(s)} <TabCount standing={seasonStanding(grouped.get(s) ?? noEpisodes, slots)} />
                </>
              ),
            }))}
          />
        </div>
        <div className="ml-auto w-56 max-sm:w-full">
          <FindEpisodeField find={find} />
        </div>
      </div>
      <div className="my-3 flex flex-wrap items-center gap-2">
        <SeasonSummary season={season} standing={seasonStanding(shown, slots)} />
        <SeasonButtons actions={actions} season={season} episodes={shown} />
        <ResetColumnWidths columns={columns} />
      </div>
      <SeasonDeleteConfirm actions={actions} season={season} />
      <EpisodeMatrix season={season} episodes={shown} slots={slots} actions={actions} found={found} columnWidths={columns} />
      <TickedBar actions={actions} />
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Episodes" className="mt-6">
      <h3 className="heading-14 mb-3">Episodes</h3>
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

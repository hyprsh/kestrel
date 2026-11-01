import { Button, Note, Skeleton, Tabs } from '@hyprsh/design'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { ApiError, useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { useColumnOrder } from '../layout/columnOrder'
import { useColumnWidths } from '../layout/columnWidths'
import { LoadingRegion } from '../loading'
import { slotKeys } from './bits'
import { SeasonDeleteConfirm, SeasonMenu, TickedBar, useEpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeMatrix, airedKey } from './EpisodeMatrix'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeason, episodeCode, isUnaired, matchesFilter, orderEpisodes, orderSeasons, seasonName, type EpisodeFilter } from './episodes'
import { grabsByEpisode } from './cellDetail'
import { SeasonGrid } from './SeasonGrid'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/**
 * What a Series adds to its Title page, below its Versions: the Seasons at a glance (a square per episode and Slot, a row per
 * season that opens it), then the open season: a toolbar (its name, a filter, Find an episode, a ⋯ menu), the episodes × Slots
 * table and, while episodes are ticked, their floating bar. The open season and the found episode live in the address bar (episodeView.ts).
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
  const order = useColumnOrder('episodes', [airedKey, ...slots])
  const queue = useQueue()
  const grabs = useMemo(() => grabsByEpisode(queue.data, title.id), [queue.data, title.id])
  const season = view.season !== null && grouped.has(view.season) ? view.season : defaultSeason(seasons)
  const inSeason = grouped.get(season) ?? noEpisodes

  // The filter and the fold of the episodes not aired yet belong to the open season: another season starts on All, folded.
  const [filter, setFilter] = useState<EpisodeFilter>('all')
  const [unairedOpen, setUnairedOpen] = useState(false)
  const [finding, setFinding] = useState(false)
  const [filteredSeason, setFilteredSeason] = useState(season)
  if (filteredSeason !== season) {
    setFilteredSeason(season)
    setFilter('all')
    setUnairedOpen(false)
  }
  const filtered = useMemo(() => inSeason.filter((e) => matchesFilter(e, slots, filter)), [inSeason, slots, filter])
  const unaired = useMemo(() => (filter === 'all' ? filtered.filter((e) => isUnaired(e, slots)) : noEpisodes), [filter, filtered, slots])
  // One episode not out yet is no bother, and a season with nothing aired shows its episodes: a lone fold row would hide the whole table.
  const folds = unaired.length > 1 && unaired.length < filtered.length
  const foundUnaired = view.episode !== null && unaired.some((e) => e.number === view.episode)
  const open = unairedOpen || foundUnaired
  const shown = useMemo(() => (folds && !open ? filtered.filter((e) => !unaired.includes(e)) : filtered), [folds, open, filtered, unaired])
  const actions = useEpisodeActions(title, episodes, shown, slots, onManualSearch)

  // The Find field: a code or part of a name goes to that episode's season and highlights it.
  const found = view.episode === null ? null : (inSeason.find((e) => e.number === view.episode)?.id ?? null)
  const find = useEpisodeFind(
    episodes,
    (hit) => {
      setFilter('all')
      if (hit) view.set(hit.season, hit.number)
      else view.set(view.season, null)
    },
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
  const code = found === null ? '' : episodeCode(inSeason.find((e) => e.id === found)!)
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

  const count = (f: EpisodeFilter) => inSeason.filter((e) => matchesFilter(e, slots, f)).length
  const filters: { value: EpisodeFilter; title: string }[] = [
    { value: 'all', title: `All ${count('all')}` },
    { value: 'missing', title: `Missing ${count('missing')}` },
    { value: 'downloading', title: `Downloading ${count('downloading')}` },
    { value: 'unaired', title: `Not aired ${count('unaired')}` },
  ]
  const name = seasonName(season)
  const showField = finding || find.text !== ''
  return (
    <>
      <SeasonGrid seasons={seasons} episodes={grouped} slots={slots} open={season} onOpen={(n) => view.set(n, null)} />
      <section aria-label={`${name} episodes`} className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="heading-16">{name}</h3>
          <Tabs variant="secondary" aria-label="Show" tabs={filters} selected={filter} onChange={(v) => setFilter(v as EpisodeFilter)} />
          <div className="ml-auto flex items-center gap-1">
            {showField ? (
              <div
                className="w-56 max-sm:w-40"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget) && find.text === '') setFinding(false)
                }}
              >
                <FindEpisodeField find={find} autoFocus />
              </div>
            ) : (
              <Button variant="tertiary" size="small" svgOnly aria-label="Find an episode" title="Find an episode" onClick={() => setFinding(true)}>
                <Search aria-hidden className="size-4" />
              </Button>
            )}
            <SeasonMenu actions={actions} season={season} episodes={inSeason} columns={columns} order={order} />
          </div>
        </div>
        <SeasonDeleteConfirm actions={actions} season={season} />
        {shown.length === 0 && !folds ? (
          <p className="copy-13 text-gray-900">No episodes match.</p>
        ) : (
          <EpisodeMatrix
            season={season}
            episodes={shown}
            slots={slots}
            columnOrder={order}
            actions={actions}
            found={found}
            grabs={grabs}
            columnWidths={columns}
            fold={folds ? { episodes: unaired, expanded: open, onToggle: () => setUnairedOpen(!open), atStart: display.season_order === 'newest_first' } : undefined}
          />
        )}
        <TickedBar actions={actions} />
      </section>
    </>
  )
}

/** The Episodes heading over what the section has to say while it has no table. */
function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Episodes" className="mt-6">
      <div className="mb-3">
        <h3 className="heading-16">Episodes</h3>
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

// chrome: domain-visual
import { Note, Skeleton, Tabs } from '@hyprsh/design'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { ApiError, useEpisodes, type Episode, type Profile, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { LoadingRegion } from '../loading'
import { useUrlParam } from '../place'
import { TickedBar, useEpisodeActions } from './EpisodeActions'
import { EpisodeRows } from './EpisodeRows'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeasons, isUnaired, matchesFilter, orderEpisodes, orderSeasons, type EpisodeFilter } from './episodes'
import { grabsByEpisode } from './cellDetail'
import { SeasonRows } from './SeasonRows'
import { useNow } from '../time'
import { VersionTable } from './VersionTable'
import { cellOf, slotsOf, useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/** The filter's value in the address ("?show=wanted"); All leaves the address clean. */
const paramOfFilter: Record<EpisodeFilter, string> = { all: '', missing: 'wanted', downloading: 'downloading', unaired: 'not-aired' }
const filterOfParam = (v: string | null): EpisodeFilter => (['missing', 'downloading', 'unaired'] as const).find((f) => paramOfFilter[f] === v) ?? 'all'

/**
 * What a Series adds to its Title page, below its header: the Versions and the Seasons as one table (VersionTable.tsx). The head row has a
 * card per Version; a row per season has the name, a cell per Version (with that Version's menu for the season) and its ⋯ menu, and opens
 * in place to its episodes, a cell per Version each (EpisodeRows.tsx). While episodes are ticked, their floating bar shows.
 * One filter above the table (All, Wanted, Downloading, Not aired, with whole-Series counts) lists only the seasons with a matching
 * episode and shows only matching episodes in the open ones. What opens by itself is up to Settings' seasons_open (nothing, by default).
 * The open seasons live in the address bar ("?open=5,3", or the old "?season=2"), as does the found episode (episodeView.ts) and the
 * filter ("?show=wanted"). The Versions come from the Title, at most four.
 */
export function SeriesSection({
  title,
  profiles,
  profileName,
  onManualSearch,
}: {
  title: TitleDetail
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch?: (t: ManualSearchTarget) => void
}) {
  const slotNames = useSlotNames()
  const slotList = useMemo(() => slotsOf(title, slotNames), [title, slotNames])
  const slots = useMemo(() => slotList.map((s) => s.key), [slotList])
  const { display, ready } = useDisplay()
  const query = useEpisodes(title.id)
  const loaded = query.data
  const episodes = useMemo(() => (loaded ? orderEpisodes(loaded, display.season_order) : noEpisodes), [loaded, display.season_order])
  const grouped = useMemo(() => bySeason(episodes), [episodes])
  const seasons = useMemo(() => orderSeasons([...grouped.keys()], display.season_order), [grouped, display.season_order])
  const view = useEpisodeView(title.id)
  const now = useNow()
  const queue = useQueue()
  const grabs = useMemo(() => grabsByEpisode(queue.data, title.id), [queue.data, title.id])

  // Which seasons are open: the address's ("?open=5,3", or the old "?season=2"), else what seasons_open says (none by default). The found episode's season is open too.
  const own = useMemo(() => {
    const wanted = seasons.filter((n) => (grouped.get(n) ?? []).some((e) => slots.some((s) => cellOf(e, s)?.state === 'wanted')))
    return defaultSeasons(seasons, wanted, display.seasons_open)
  }, [seasons, grouped, slots, display.seasons_open])
  const open = useMemo(() => {
    const named = view.open ?? (view.season !== null ? [view.season] : own)
    const set = new Set(named.filter((n) => grouped.has(n)))
    if (view.season !== null && view.episode !== null && grouped.has(view.season)) set.add(view.season)
    return set
  }, [view.open, view.season, view.episode, own, grouped])
  const toggle = (n: number) => view.setOpen(seasons.filter((s) => (s === n ? !open.has(n) : open.has(s))))

  // The filter above the Seasons (kept in the address, "?show=wanted") and the fold of the episodes not aired yet in each open season.
  const [shownParam, setShownParam] = useUrlParam('show')
  const filter = filterOfParam(shownParam)
  const setFilter = useCallback((f: EpisodeFilter) => setShownParam(f === 'all' ? null : paramOfFilter[f]), [setShownParam])
  // Another Title starts unfiltered; the address of the first one keeps what it names.
  const lastTitle = useRef(title.id)
  useEffect(() => {
    if (lastTitle.current === title.id) return
    lastTitle.current = title.id
    setShownParam(null)
  }, [title.id, setShownParam])
  const [folded, setFolded] = useState<Record<number, boolean>>({})
  const shownOf = useMemo(() => {
    return (n: number) => {
      const inSeason = grouped.get(n) ?? noEpisodes
      const filtered = inSeason.filter((e) => matchesFilter(e, slots, filter))
      const unaired = filter === 'all' ? filtered.filter((e) => isUnaired(e, slots)) : noEpisodes
      // One episode not out yet is no bother, and a season with nothing aired shows its episodes: a lone fold row would hide the whole table.
      const folds = unaired.length > 1 && unaired.length < filtered.length
      const foundHere = view.season === n && view.episode !== null && unaired.some((e) => e.number === view.episode)
      const expanded = !!folded[n] || foundHere
      return { inSeason, filtered, unaired, folds, expanded, shown: folds && !expanded ? filtered.filter((e) => !unaired.includes(e)) : filtered }
    }
  }, [grouped, filter, folded, slots, view.season, view.episode])
  // With a filter picked only the seasons holding a match are listed; the others keep their open or closed state.
  const listed = useMemo(() => (filter === 'all' ? seasons : seasons.filter((n) => (grouped.get(n) ?? noEpisodes).some((e) => matchesFilter(e, slots, filter)))), [seasons, grouped, slots, filter])
  const shown = useMemo(() => listed.filter((n) => open.has(n)).flatMap((n) => shownOf(n).shown), [listed, open, shownOf])
  const actions = useEpisodeActions(title, episodes, shown, slots, onManualSearch)

  // A cell's "Show the N Wanted Episodes": the table is filtered to what is Wanted, and the season opens.
  const showWanted = (n: number) => {
    setFilter('missing')
    if (!open.has(n)) view.setOpen(seasons.filter((s) => s === n || open.has(s)))
  }

  // A season's "Select All": a closed season opens first (only the open seasons' episodes can be ticked), then its episodes are ticked.
  const [ticking, setTicking] = useState<number | null>(null)
  const selectSeason = (n: number) => {
    if (!open.has(n)) toggle(n)
    setTicking(n)
  }
  const { checkIds } = actions.selection
  useEffect(() => {
    if (ticking === null || !open.has(ticking)) return
    checkIds(shownOf(ticking).shown.map((e) => e.id))
    setTicking(null)
  }, [ticking, open, shownOf, checkIds])

  // The episode an address names ("?season=&episode="), highlighted in its season.
  const inFoundSeason = view.season !== null ? (grouped.get(view.season) ?? noEpisodes) : noEpisodes
  const found = view.episode === null ? null : (inFoundSeason.find((e) => e.number === view.episode)?.id ?? null)

  const manual = onManualSearch ?? (() => {})
  // Whether there is a table of episodes to work with; until then the head shows its Versions over a note, a skeleton or the error.
  const ok = !query.isError && !!loaded && ready && episodes.length > 0

  const count = (f: EpisodeFilter) => episodes.filter((e) => matchesFilter(e, slots, f)).length
  const filterTabs: { value: EpisodeFilter; title: string }[] = [
    { value: 'all', title: `All ${count('all')}` },
    { value: 'missing', title: `Wanted ${count('missing')}` },
    { value: 'downloading', title: `Downloading ${count('downloading')}` },
    { value: 'unaired', title: `Not aired ${count('unaired')}` },
  ]
  const body = (n: number) => {
    const { unaired, folds, expanded, shown: rows } = shownOf(n)
    return rows.length === 0 && !folds ? (
      <p className="copy-13 border-t border-gray-alpha-200 px-3.5 py-3 text-gray-900">No episodes match.</p>
    ) : (
      <EpisodeRows
        season={n}
        episodes={rows}
        slots={slotList}
        actions={actions}
        found={found}
        grabs={grabs}
        fold={folds ? { episodes: unaired, expanded, onToggle: () => setFolded((f) => ({ ...f, [n]: !expanded })), atStart: display.season_order === 'newest_first' } : undefined}
      />
    )
  }
  let rows: ReactNode
  if (query.isError) {
    rows = (
      <div className="px-3.5 py-3">
        <Note variant="error" size="small">
          {query.error instanceof ApiError ? query.error.message : 'Could not load the episodes.'}
        </Note>
      </div>
    )
  } else if (!loaded || !ready) rows = <EpisodesSkeleton />
  else if (episodes.length === 0) rows = <p className="copy-13 px-3.5 py-3 text-gray-900">TheTVDB lists no episodes yet.</p>
  else if (listed.length === 0) rows = <p className="copy-13 border-t border-gray-alpha-200 px-3.5 py-3 text-gray-900">No episodes match.</p>
  else
    rows = (
      <SeasonRows seasons={listed} episodes={grouped} slots={slotList} open={open} onToggle={toggle} actions={actions} onSelectAll={selectSeason} onShowWanted={showWanted} now={now} body={body} />
    )
  return (
    <section aria-label="Versions" className="mt-6 flex flex-col gap-3">
      <h3 className="heading-16">Versions</h3>
      {ok && <Tabs variant="secondary" aria-label="Show episodes" tabs={filterTabs} selected={filter} onChange={(v) => setFilter(v as EpisodeFilter)} />}
      <VersionTable
        title={title}
        slots={slotList}
        profiles={profiles}
        profileName={profileName}
        onManualSearch={manual}
        seasonCount={seasons.filter((n) => n > 0).length}
        episodeCount={episodes.length}
        marked={view.slot}
      >
        {rows}
      </VersionTable>
      {ok && <TickedBar actions={actions} />}
    </section>
  )
}

/** The rows of the table while the episodes load, in the shape of the real ones. */
function EpisodesSkeleton() {
  return (
    <LoadingRegion label="Loading episodes">
      <div aria-hidden className="flex flex-col gap-3 p-3.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width={`${70 + ((i * 13) % 30)}%`} height={24} />
        ))}
      </div>
    </LoadingRegion>
  )
}

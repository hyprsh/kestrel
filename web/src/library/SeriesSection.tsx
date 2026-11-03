// chrome: domain-visual
import { Button, Note, Skeleton, Tabs } from '@hyprsh/design'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { ApiError, useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { LoadingRegion } from '../loading'
import { useUrlParam } from '../place'
import { TickedBar, useEpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeList } from './EpisodeList'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeasons, episodeCode, isUnaired, matchesFilter, orderEpisodes, orderSeasons, seasonName, type EpisodeFilter } from './episodes'
import { grabsByEpisode } from './cellDetail'
import { SeasonAccordion } from './SeasonAccordion'
import { chipColumn } from './StateBar'
import { cellOf, slotsOf, useSlotNames } from './slots'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/** The filter's value in the address ("?show=wanted"); All leaves the address clean. */
const paramOfFilter: Record<EpisodeFilter, string> = { all: '', missing: 'wanted', downloading: 'downloading', unaired: 'not-aired' }
const filterOfParam = (v: string | null): EpisodeFilter => (['missing', 'downloading', 'unaired'] as const).find((f) => paramOfFilter[f] === v) ?? 'all'

/**
 * What a Series adds to its Title page, below its header: the Seasons as an accordion (one row per season with its
 * bookmark, a bar of its episodes, a chip per Slot, the count and its actions: Search Season and a menu), each opening in place to
 * its episode list (a chip per Slot), and, while episodes are ticked, their floating bar.
 * One filter above the rows (All, Wanted, Downloading, Not aired, with whole-Series counts) lists only the seasons with a matching
 * episode and shows only matching episodes in the open ones. What opens by itself is up to Settings' seasons_open (nothing, by default).
 * The open seasons live in the address bar ("?open=5,3", or the old "?season=2"), as does the found episode (episodeView.ts) and the
 * filter ("?show=wanted"). The Slots come from the Title's Versions, any number.
 */
export function SeriesSection({ title, onManualSearch }: { title: TitleDetail; onManualSearch?: (t: ManualSearchTarget) => void }) {
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
  const [finding, setFinding] = useState(false)
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

  // The Find field: a code or part of a name goes to that episode's season (which opens) and highlights it.
  const inFoundSeason = view.season !== null ? (grouped.get(view.season) ?? noEpisodes) : noEpisodes
  const found = view.episode === null ? null : (inFoundSeason.find((e) => e.number === view.episode)?.id ?? null)
  const find = useEpisodeFind(
    episodes,
    (hit) => {
      if (hit) {
        const target = (grouped.get(hit.season) ?? noEpisodes).find((e) => e.number === hit.number)
        if (target && !matchesFilter(target, slots, filter)) setFilter('all')
        view.found(
          hit.season,
          hit.number,
          seasons.filter((n) => n === hit.season || open.has(n)),
        )
      } else view.set(view.season, null)
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
  const code = found === null ? '' : episodeCode(inFoundSeason.find((e) => e.id === found)!)
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

  const allOpen = listed.length > 0 && listed.every((n) => open.has(n))
  const count = (f: EpisodeFilter) => episodes.filter((e) => matchesFilter(e, slots, f)).length
  const filterTabs: { value: EpisodeFilter; title: string }[] = [
    { value: 'all', title: `All ${count('all')}` },
    { value: 'missing', title: `Wanted ${count('missing')}` },
    { value: 'downloading', title: `Downloading ${count('downloading')}` },
    { value: 'unaired', title: `Not aired ${count('unaired')}` },
  ]
  const showField = finding || find.text !== ''
  const body = (n: number) => {
    const { unaired, folds, expanded, shown: rows } = shownOf(n)
    const name = seasonName(n)
    return (
      <section aria-label={`${name} episodes`}>
        {rows.length === 0 && !folds ? (
          <p className="copy-13 px-3.5 py-3 text-gray-900">No episodes match.</p>
        ) : (
          <EpisodeList
            season={n}
            episodes={rows}
            slots={slotList}
            actions={actions}
            found={found}
            grabs={grabs}
            fold={folds ? { episodes: unaired, expanded, onToggle: () => setFolded((f) => ({ ...f, [n]: !expanded })), atStart: display.season_order === 'newest_first' } : undefined}
          />
        )}
      </section>
    )
  }
  return (
    <section aria-label="Seasons" className="mt-6 flex flex-col gap-2" style={chipColumn(slotList.length)}>
      <div className="flex items-center gap-2">
        <h3 className="heading-16 flex-1">Seasons</h3>
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
          <Button variant="secondary" size="small" aria-label="Find an Episode" title="Find an Episode" prefix={<Search aria-hidden className="size-4" />} onClick={() => setFinding(true)}>
            Find
          </Button>
        )}
        <Button variant="secondary" size="small" onClick={() => view.setOpen(seasons.filter((n) => (listed.includes(n) ? !allOpen : open.has(n))))}>
          {allOpen ? 'Collapse All' : 'Expand All'}
        </Button>
      </div>
      <Tabs variant="secondary" aria-label="Show episodes" tabs={filterTabs} selected={filter} onChange={(v) => setFilter(v as EpisodeFilter)} />
      {listed.length === 0 ? (
        <p className="copy-13 py-2 text-gray-900">No episodes match.</p>
      ) : (
        <SeasonAccordion seasons={listed} episodes={grouped} slots={slotList} open={open} onToggle={toggle} actions={actions} onSelectAll={selectSeason} body={body} />
      )}
      <TickedBar actions={actions} />
    </section>
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

// chrome: domain-visual
import { Button, Note, Skeleton, Tabs } from '@hyprsh/design'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueue } from '../api/queue'
import { ApiError, useEpisodes, type Episode, type TitleDetail } from '../api/queries'
import { useDisplay } from '../display/useDisplay'
import { LoadingRegion } from '../loading'
import { usePhone } from '../responsive'
import { EpisodeDeleteConfirm } from './DeleteFiles'
import { SeasonMenu, SeasonSearchButton, TickedBar, useEpisodeActions } from './EpisodeActions'
import { FindEpisodeField, useEpisodeFind } from './EpisodeFind'
import { EpisodeList } from './EpisodeList'
import { useEpisodeView } from './episodeView'
import { bySeason, defaultSeason, episodeCode, isUnaired, matchesFilter, orderEpisodes, orderSeasons, seasonName, seasonRow, type EpisodeFilter } from './episodes'
import { grabsByEpisode } from './cellDetail'
import { MonitorToggle } from './MonitorToggle'
import { SeasonAccordion } from './SeasonAccordion'
import { cellOf, slotsOf } from './slots'
import type { ManualSearchTarget } from './TitleDetail'

const noEpisodes: Episode[] = []

/**
 * What a Series adds to its Title page, below its header: the Seasons as an accordion (one row per season with its
 * bookmark, a bar of its episodes, a chip per Slot and the count), each opening in place to the season's tools (its
 * filters, Search season, its menu) and episode list (a chip per Slot), and, while episodes are ticked, their floating bar.
 * The first season with something Wanted opens by itself. The open seasons live in the address bar ("?open=5,3", or the old
 * "?season=2"), as does the found episode (episodeView.ts). The Slots come from the Title's Versions, any number.
 */
export function SeriesSection({ title, onManualSearch }: { title: TitleDetail; onManualSearch?: (t: ManualSearchTarget) => void }) {
  const slotList = useMemo(() => slotsOf(title), [title])
  const slots = useMemo(() => slotList.map((s) => s.key), [slotList])
  const { display, ready } = useDisplay()
  const phone = usePhone()
  const query = useEpisodes(title.id)
  const loaded = query.data
  const episodes = useMemo(() => (loaded ? orderEpisodes(loaded, display.season_order) : noEpisodes), [loaded, display.season_order])
  const grouped = useMemo(() => bySeason(episodes), [episodes])
  const seasons = useMemo(() => orderSeasons([...grouped.keys()], display.season_order), [grouped, display.season_order])
  const view = useEpisodeView(title.id)
  const queue = useQueue()
  const grabs = useMemo(() => grabsByEpisode(queue.data, title.id), [queue.data, title.id])

  // Which seasons are open: the address's ("?open=5,3", or the old "?season=2"), else the first with something Wanted (the newest when nothing is). The found episode's season is open too.
  const own = useMemo(() => {
    const wanted = seasons.find((n) => (grouped.get(n) ?? []).some((e) => slots.some((s) => cellOf(e, s)?.state === 'wanted')))
    return wanted ?? defaultSeason(seasons, display.seasons_open)
  }, [seasons, grouped, slots, display.seasons_open])
  const open = useMemo(() => {
    const named = view.open ?? (view.season !== null ? [view.season] : [own])
    const set = new Set(named.filter((n) => grouped.has(n)))
    if (view.season !== null && view.episode !== null && grouped.has(view.season)) set.add(view.season)
    return set
  }, [view.open, view.season, view.episode, own, grouped])
  const toggle = (n: number) => view.setOpen(seasons.filter((s) => (s === n ? !open.has(n) : open.has(s))))
  const allOpen = seasons.length > 0 && seasons.every((n) => open.has(n))

  // The filter and the fold of the episodes not aired yet belong to each open season.
  const [filters, setFilters] = useState<Record<number, EpisodeFilter>>({})
  const [folded, setFolded] = useState<Record<number, boolean>>({})
  const [finding, setFinding] = useState(false)
  const shownOf = useMemo(() => {
    return (n: number) => {
      const inSeason = grouped.get(n) ?? noEpisodes
      const filter = filters[n] ?? 'all'
      const filtered = inSeason.filter((e) => matchesFilter(e, slots, filter))
      const unaired = filter === 'all' ? filtered.filter((e) => isUnaired(e, slots)) : noEpisodes
      // One episode not out yet is no bother, and a season with nothing aired shows its episodes: a lone fold row would hide the whole table.
      const folds = unaired.length > 1 && unaired.length < filtered.length
      const foundHere = view.season === n && view.episode !== null && unaired.some((e) => e.number === view.episode)
      const expanded = !!folded[n] || foundHere
      return { inSeason, filter, filtered, unaired, folds, expanded, shown: folds && !expanded ? filtered.filter((e) => !unaired.includes(e)) : filtered }
    }
  }, [grouped, filters, folded, slots, view.season, view.episode])
  const shown = useMemo(() => seasons.filter((n) => open.has(n)).flatMap((n) => shownOf(n).shown), [seasons, open, shownOf])
  const actions = useEpisodeActions(title, episodes, shown, slots, onManualSearch)

  // The Find field: a code or part of a name goes to that episode's season (which opens) and highlights it.
  const inFoundSeason = view.season !== null ? (grouped.get(view.season) ?? noEpisodes) : noEpisodes
  const found = view.episode === null ? null : (inFoundSeason.find((e) => e.number === view.episode)?.id ?? null)
  const find = useEpisodeFind(
    episodes,
    (hit) => {
      if (hit) {
        setFilters((f) => ({ ...f, [hit.season]: 'all' }))
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

  const showField = finding || find.text !== ''
  const body = (n: number) => {
    const { inSeason, filter, unaired, folds, expanded, shown: rows } = shownOf(n)
    const count = (f: EpisodeFilter) => inSeason.filter((e) => matchesFilter(e, slots, f)).length
    const filters_: { value: EpisodeFilter; title: string }[] = [
      { value: 'all', title: `All ${count('all')}` },
      { value: 'missing', title: `Wanted ${count('missing')}` },
      { value: 'downloading', title: `Downloading ${count('downloading')}` },
      { value: 'unaired', title: `Not aired ${count('unaired')}` },
    ]
    const name = seasonName(n)
    const monitored = inSeason.some((e) => e.monitored)
    return (
      <section aria-label={`${name} episodes`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-gray-alpha-200 px-3.5 py-2">
          <Tabs variant="secondary" aria-label={`Show in ${name}`} tabs={filters_} selected={filter} onChange={(v) => setFilters((f) => ({ ...f, [n]: v as EpisodeFilter }))} />
          <div className="ml-auto flex items-center gap-1.5">
            {phone && <MonitorToggle name={name} monitored={monitored} onToggle={() => actions.monitorSeason(n, !monitored)} />}
            <SeasonSearchButton actions={actions} season={n} episodes={inSeason} />
            <SeasonMenu actions={actions} season={n} episodes={inSeason} label={`${name} actions`} />
          </div>
        </div>
        <EpisodeDeleteConfirm deletes={actions.deletes} at={seasonRow(n)} />
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
    <section aria-label="Seasons" className="mt-6 flex flex-col gap-2">
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
          <Button variant="tertiary" size="small" svgOnly aria-label="Find an episode" title="Find an episode" onClick={() => setFinding(true)}>
            <Search aria-hidden className="size-4" />
          </Button>
        )}
        <Button variant="tertiary" size="small" onClick={() => view.setOpen(allOpen ? [] : seasons)}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      <SeasonAccordion seasons={seasons} episodes={grouped} slots={slotList} open={open} onToggle={toggle} actions={actions} body={body} />
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

import { Button, EmptyState, KeyboardInput, Note, parseQuery, Skeleton } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles, useTitles, type TitleRow } from '../api/queries'
import { useQueue } from '../api/queue'
import { useOpenCleanup } from '../cleanup/launch'
import { FilterBar } from '../filter/FilterBar'
import { useKey, useListNav } from '../keys'
import { FacetFilterButton, SortButton } from '../layout/FilterButton'
import { PaneFooter } from '../layout/Pane'
import { PhoneBackHeader } from '../layout/PhoneBackHeader'
import { ScreenBar } from '../layout/ScreenBar'
import { WideListPane } from '../layout/WideListPane'
import { usePhone } from '../responsive'
import { useSelection } from '../selection'
import { useNow } from '../time'
import { size, slotLabel } from './bits'
import { BulkActions } from './BulkActions'
import { EpisodeViewContext } from './episodeView'
import { episodeCode, seasonName } from './episodes'
import { useEpisodeSearch, type EpisodeActions } from './EpisodeActions'
import { EpisodeHitRows, hitDomId } from './EpisodeHitRows'
import { filterLibrary, libraryQualifiers, tabCounts, tabOf, withTab } from './filter'
import { AddTitle, LibraryMenu, StatusSection } from './LibraryBar'
import { ManualSearch } from './ManualSearch'
import { grabsByTitle } from './rowState'
import { TitleDetail, type ManualSearchTarget } from './TitleDetail'
import { TitleRows } from './TitleRows'
import { useEpisodeResults, type EpisodeHit } from './useEpisodeResults'

/**
 * The Library. Across the top, one bar, in the top bar of a desktop: the filter field with its Filter button (whose Status section holds the `is:`
 * states, each with its count) and the Sort button, then after Health the Library-wide "…" menu and Add Title. The count is in the footer.
 * The list is two panes: the filterable list on the left and the selected Title on the right.
 *
 * Everything is reachable from the keyboard: j/k and the arrows move, Enter steps into the Title,
 * Escape steps back, `/` filters (with qualifiers such as is:wanted, see ./filter.ts, kept in the address bar), x ticks
 * the Title under the cursor. While Titles are ticked a bar floats over the foot of the list with what can be done to
 * them together, and Escape clears the ticks.
 *
 * On a phone the list and the Title page are two screens: tapping a Title opens its page full screen (`titleOpen`,
 * kept by the Shell in the address bar so Back returns to the list), the bar wraps and
 * the rows show tick boxes once Tick Titles in the "…" menu asks for them.
 */
export function Library({
  selectedId,
  onSelect,
  titleOpen,
  onOpenTitle,
  onCloseTitle,
  onAdd,
  onAdopt,
  query,
  onQuery,
}: {
  selectedId: number | null
  onSelect: (id: number) => void
  /** Phone only: whether the Title page shows instead of the list, and how a tap opens a Title and Back closes it. */
  titleOpen: boolean
  onOpenTitle: (id: number) => void
  onCloseTitle: () => void
  onAdd: () => void
  onAdopt: () => void
  /** The filter field's text, kept by the Shell so it can live in the address bar. */
  query: string
  onQuery: (query: string) => void
}) {
  const phone = usePhone()
  const titles = useTitles()
  const queue = useQueue().data
  const now = useNow()
  const openCleanup = useOpenCleanup()
  const profiles = useProfiles().data
  const qualifiers = useMemo(() => libraryQualifiers((profiles ?? []).map((p) => ({ name: p.name, description: `${p.min_height}–${p.max_height}p` }))), [profiles])
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)

  const all = titles.data ?? []
  const grabs = useMemo(() => grabsByTitle(queue), [queue])
  const grabbing = useMemo(() => new Set(grabs.keys()), [grabs])
  const parsed = useMemo(() => parseQuery(query, qualifiers), [query, qualifiers])
  const rows = useMemo(() => filterLibrary(all, parsed, profiles ?? [], grabbing), [all, parsed, profiles, grabbing])
  const counts = useMemo(() => (titles.isSuccess ? tabCounts(all, parsed, profiles ?? [], grabbing) : null), [titles.isSuccess, all, parsed, profiles, grabbing])
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selection = useSelection(ids)
  const index = Math.max(
    0,
    rows.findIndex((r) => r.id === selectedId),
  ) // the first row until something is picked
  const current = rows[index] as TitleRow | undefined
  // The Episode and Season results above the Titles (a filter such as "harbour s2e5"): the cursor moves
  // through them and then the Titles. `hitKey` is the result it is on, null while it is on a Title.
  const hits = useEpisodeResults(rows, parsed.text, true)
  const [hitKey, setHitKey] = useState<string | null>(null)
  const hitAt = hitKey === null ? -1 : hits.findIndex((h) => h.key === hitKey)
  const hit = hitAt >= 0 ? hits[hitAt] : null
  const cursor = hit ? hitAt : hits.length + index
  const episodeView = useContext(EpisodeViewContext)
  const episodeSearch = useEpisodeSearch()
  const showHit = (h: EpisodeHit) => {
    setHitKey(h.key)
    onSelect(h.title.id)
    episodeView?.setView({ titleId: h.title.id, season: h.season, episode: h.episode?.number ?? null })
  }
  const moveTo = (i: number) => {
    if (i < hits.length) showHit(hits[i])
    else {
      setHitKey(null)
      onSelect(rows[i - hits.length].id)
    }
  }
  // A new first result (a new filter, or its episodes arriving) takes the cursor.
  const firstHit = hits[0]?.key ?? null
  useEffect(() => {
    setHitKey(firstHit)
    if (hits[0]) onSelect(hits[0].title.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstHit])
  // A manual search replaces the Title pane; picking another Title in the list closes it.
  const [search, setSearch] = useState<(ManualSearchTarget & { titleId: number }) | null>(null)
  const searching = search !== null && search.titleId === current?.id
  // The listbox (EntityList takes no ref), inside the scroller that holds the ref.
  const focusList = () => listRef.current?.querySelector<HTMLElement>('[role=listbox]')?.focus()
  useEffect(focusList, [])
  const keys = !searching && !(phone && titleOpen)
  useListNav(
    'lib',
    hits.length + rows.length,
    cursor,
    moveTo,
    () => {
      if (hit) {
        showHit(hit)
        if (phone) onOpenTitle(hit.title.id)
        else paneRef.current?.focus()
      } else if (phone) {
        if (current) onOpenTitle(current.id)
      } else paneRef.current?.focus()
    },
    keys,
  )
  useKey(
    '/',
    (e) => {
      e.preventDefault()
      document.getElementById('library-filter')?.focus()
    },
    keys,
  )
  useKey('x', () => current && !hit && selection.toggle(current.id), keys)
  // `s` and `m` on a result: Search now, and Manual search (in the Slot that is Wanted, else the first).
  useKey(
    's',
    () =>
      hit &&
      actionsOf(hit).search(
        hit.episodes,
        hit.episode ? episodeCode(hit.episode!) : seasonName(hit.season),
        hit.episode ? (ids) => ({ season: hit.season, episode_ids: ids }) : () => ({ season: hit.season }),
      ),
    keys && hit !== null,
  )
  useKey(
    'm',
    () => {
      if (!hit) return
      const v = hit.versions.find((x) => hit.episodes.some((e) => e.cells[x.slot]?.state === 'wanted')) ?? hit.versions[0]
      if (v) actionsOf(hit).manual(v, hit.episode ? { season: hit.season, episode_ids: [hit.episode.id] } : { season: hit.season }, hit.episode ? episodeCode(hit.episode!) : seasonName(hit.season))
    },
    keys && hit !== null,
  )

  const empty = titles.isSuccess && all.length === 0
  const total = rows.reduce((n, r) => n + r.size, 0)
  const counted = titles.isPending ? null : [`${rows.length} of ${all.length}`, total > 0 ? size(total) : null]

  const field = (
    <FilterBar
      id="library-filter"
      label="Filter the Library"
      placeholder={phone ? 'Filter titles' : 'Filter titles, e.g. slot:4k  /'}
      value={query}
      onChange={onQuery}
      qualifiers={qualifiers}
      menus={false}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const next = Math.min(Math.max(cursor + (e.key === 'ArrowDown' ? 1 : -1), 0), hits.length + rows.length - 1)
          if (hits.length + rows.length > 0) moveTo(next)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onQuery('')
          focusList()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          focusList()
        }
      }}
    />
  )

  const status = <StatusSection selected={tabOf(parsed)} counts={counts} onSelect={(tab) => onQuery(withTab(query, tab, qualifiers))} />
  const menu = <LibraryMenu onAdopt={onAdopt} onCleanup={() => openCleanup()} onTick={phone ? () => selection.setActive(true) : undefined} />
  const count = <span className="label-12 shrink-0 text-gray-900 tabular-nums">{counted ? counted.filter(Boolean).join(' · ') : <Skeleton width={48} height={14} />}</span>

  const bulk = selection.count > 0 ? <BulkActions rows={rows.filter((r) => selection.has(r.id))} shown={rows.length} onTickAll={selection.checkAll} onClear={selection.clear} compact={phone} /> : null

  const pick = (r: TitleRow) => {
    setHitKey(null)
    onSelect(r.id)
    if (phone) onOpenTitle(r.id)
    else {
      focusList()
    }
  }
  const items = (
    <TitleRows
      rows={rows}
      index={hit ? -1 : index}
      loading={titles.isPending}
      grabs={grabs}
      now={now}
      selection={selection}
      ticks={!phone || selection.active}
      phone={phone}
      listRef={listRef}
      onPick={pick}
      lead={
        <EpisodeHitRows
          hits={hits}
          current={hit}
          actionsOf={actionsOf}
          phone={phone}
          onPick={(h) => {
            showHit(h)
            if (phone) onOpenTitle(h.title.id)
            else focusList()
          }}
        />
      }
      navOffset={hits.length}
      activeId={hit ? hitDomId(hit) : undefined}
    />
  )
  const nothing = (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      {titles.isError ? (
        <Note variant="error" size="small">
          Could not load the Library.
        </Note>
      ) : empty ? (
        <EmptyState title="Nothing here yet" description="Add your first Movie or Series.">
          <Button variant="primary" size="small" prefix={<Plus />} onClick={onAdd}>
            Add a title
          </Button>
        </EmptyState>
      ) : titles.isSuccess ? (
        <EmptyState title="No Title matches." />
      ) : null}
    </div>
  )
  const startSearchFor = (titleId: number, s: ManualSearchTarget) => setSearch({ ...s, titleId })
  const startSearch = (s: ManualSearchTarget) => current && startSearchFor(current.id, s)
  /** What Search and Manual… do on a result row: for that Series, whichever Title the pane shows. */
  function actionsOf(h: EpisodeHit): Pick<EpisodeActions, 'versions' | 'search' | 'manual'> {
    return {
      versions: h.versions,
      search: (eps, label, scope) => episodeSearch(h.versions, eps, label, scope),
      manual: (v, body, label) => {
        showHit(h)
        startSearchFor(h.title.id, { versionId: v.id, slot: v.slot, profileName: v.profileName, scope: { body, label } })
      },
    }
  }
  // The selected Title's page, or the manual search that replaces it; `onEscape` is where Escape in the page goes.
  const titlePage = (onEscape: () => void) =>
    current && searching ? (
      <ManualSearch
        key={`${search.versionId} ${JSON.stringify(search.scope?.body ?? null)}`}
        titleName={current.title}
        slotLabel={slotLabel[search.slot]}
        profileName={search.profileName}
        versionId={search.versionId}
        scope={search.scope}
        onBack={() => {
          setSearch(null)
          requestAnimationFrame(() => paneRef.current?.focus())
        }}
      />
    ) : current ? (
      <TitleDetail key={current.id} ref={paneRef} row={current} onEscape={onEscape} onManualSearch={startSearch} />
    ) : (
      nothing
    )

  // A phone shows one screen: a Title's page with a back button, or the list.
  if (phone && titleOpen)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {!searching && <PhoneBackHeader onBack={onCloseTitle}>{current?.title}</PhoneBackHeader>}
        {titlePage(onCloseTitle)}
      </div>
    )

  // One bar across the whole screen, above the list and the Title; On a desktop it sits in the top bar.
  const bar = (filtering: boolean) => (
    <ScreenBar
      menu={menu}
      actions={phone ? undefined : <AddTitle onAdd={onAdd} />}
      filter={filtering ? field : undefined}
      controls={
        <>
          <FacetFilterButton query={query} onQuery={onQuery} qualifiers={qualifiers} lead={status} leadActive={parsed.terms.some((t) => t.name === 'is') ? 1 : 0} />
          <SortButton query={query} onQuery={onQuery} qualifiers={qualifiers} />
        </>
      }
    />
  )

  if (phone)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {bar(true)}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {rows.length === 0 && !titles.isPending ? nothing : items}
          {bulk}
        </div>
      </div>
    )

  const hints = (
    <span className="label-12 flex items-center gap-1 text-gray-900 pointer-coarse:hidden">
      <KeyboardInput small>j</KeyboardInput>
      <KeyboardInput small>k</KeyboardInput> move <KeyboardInput small>x</KeyboardInput> tick
    </span>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {bar(true)}
      <div className="flex min-h-0 flex-1">
        <WideListPane>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {items}
            {bulk}
          </div>
          <PaneFooter>
            {hints}
            <span className="ml-auto">{count}</span>
          </PaneFooter>
        </WideListPane>
        {titlePage(focusList)}
      </div>
    </div>
  )
}

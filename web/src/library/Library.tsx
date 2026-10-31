import { Button, EmptyState, KeyboardInput, Note, parseQuery, Skeleton } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles, useTitles, type TitleRow } from '../api/queries'
import { useQueue } from '../api/queue'
import { useOpenCleanup } from '../cleanup/launch'
import { FilterBar } from '../filter/FilterBar'
import { useKey, useListNav } from '../keys'
import { FilterStrip } from '../layout/FilterStrip'
import { PaneFooter } from '../layout/Pane'
import { PhoneBackHeader } from '../layout/PhoneBackHeader'
import { TabStrip } from '../layout/TabStrip'
import { WideListPane } from '../layout/WideListPane'
import { usePhone } from '../responsive'
import { useSelection } from '../selection'
import { useNow } from '../time'
import { size, slotLabel } from './bits'
import { BulkActions } from './BulkActions'
import { filterLibrary, libraryQualifiers, sortLabel, sortOfQuery, tabCounts, tabOf, withTab } from './filter'
import { AddTitle, LibraryMenu, StateTabs, ViewSwitch } from './LibraryBar'
import { ManualSearch } from './ManualSearch'
import { grabsByTitle } from './rowState'
import { TitleDetail, type ManualSearchTarget } from './TitleDetail'
import { TitleGrid } from './TitleGrid'
import { TitleRows } from './TitleRows'
import { TitleSummary } from './TitleSummary'
import { useLibraryView } from './useLibraryView'

/** The qualifiers with a filter menu, which the phone's Filters button counts. */
const menuTerms = new Set(['kind', 'slot', 'profile', 'sort'])

/**
 * The Library. Across the top, the state tabs (each an `is:` filter, with its count), the grid/list switch, the
 * Library-wide "…" menu and Add Title. The list view (the default) is two panes: the filterable list on the left and
 * the selected Title on the right. The grid view is a wall of posters; picking one opens its summary in a panel on
 * the right, and Open Title shows its whole page. The view is remembered in this browser, and `g` switches it.
 *
 * Everything is reachable from the keyboard: j/k and the arrows move, Enter steps into the Title (or its summary),
 * Escape steps back, `/` filters (with qualifiers such as is:wanted, see ./filter.ts, kept in the address bar), x ticks
 * the Title under the cursor. While Titles are ticked a bar floats over the foot of the list with what can be done to
 * them together, and Escape clears the ticks.
 *
 * On a phone the list and the Title page are two screens: tapping a Title opens its page full screen (`titleOpen`,
 * kept by the Shell in the address bar so Back returns to the list), the filter menus sit behind a Filters button and
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
  const [view, setView] = useLibraryView()
  const grid = view === 'grid'
  const qualifiers = useMemo(() => libraryQualifiers((profiles ?? []).map((p) => ({ name: p.name, description: `${p.min_height}–${p.max_height}p` }))), [profiles])
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

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
  // A manual search replaces the Title pane; picking another Title in the list closes it.
  const [search, setSearch] = useState<(ManualSearchTarget & { titleId: number }) | null>(null)
  const searching = search !== null && search.titleId === current?.id
  // The grid's summary panel, and the whole Title page over the grid that Open Title shows (on a wide screen; a phone opens Titles full screen).
  const [summary, setSummary] = useState(false)
  const [opened, setOpened] = useState(false)
  const gridPage = grid && !phone && opened && current !== undefined

  // The listbox (EntityList takes no ref), inside the scroller that holds the ref.
  const focusList = () => listRef.current?.querySelector<HTMLElement>('[role=listbox]')?.focus()
  useEffect(focusList, [view])
  const keys = !searching && !gridPage && !(phone && titleOpen)
  useListNav(
    'lib',
    rows.length,
    index,
    (i) => onSelect(rows[i].id),
    () => {
      if (phone) {
        if (current) onOpenTitle(current.id)
      } else if (grid) {
        setSummary(true)
        requestAnimationFrame(() => summaryRef.current?.focus())
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
  useKey('x', () => current && selection.toggle(current.id), keys)
  useKey('g', () => setView(grid ? 'list' : 'grid'), keys)
  // Escape closes the grid's summary, once there are no ticks for it to clear first.
  useKey(
    'Escape',
    (e) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      setSummary(false)
    },
    keys && grid && summary && selection.count === 0,
  )

  const [filtersOpen, setFiltersOpen] = useState(false)
  const empty = titles.isSuccess && all.length === 0
  const total = rows.reduce((n, r) => n + r.size, 0)
  const counted = titles.isPending ? null : [`${rows.length} of ${all.length}`, total > 0 ? size(total) : null]

  const field = (
    <FilterBar
      id="library-filter"
      label="Filter the Library"
      placeholder={phone ? 'Filter' : 'Filter, e.g. slot:4k  /'}
      value={query}
      onChange={onQuery}
      qualifiers={qualifiers}
      menus={!phone || filtersOpen}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const next = Math.min(Math.max(index + (e.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)
          if (rows[next]) onSelect(rows[next].id)
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

  const tabs = <StateTabs phone={phone} selected={tabOf(parsed)} counts={counts} onSelect={(tab) => onQuery(withTab(query, tab, qualifiers))} />
  const switcher = <ViewSwitch phone={phone} view={view} onChange={setView} />
  const menu = <LibraryMenu onAdopt={onAdopt} onCleanup={() => openCleanup()} onTick={phone ? () => selection.setActive(true) : undefined} />
  const count = <span className="label-12 shrink-0 text-gray-900 tabular-nums">{counted ? counted.filter(Boolean).join(' · ') : <Skeleton width={48} height={14} />}</span>

  const bulk = selection.count > 0 ? <BulkActions rows={rows.filter((r) => selection.has(r.id))} shown={rows.length} onTickAll={selection.checkAll} onClear={selection.clear} compact={phone} /> : null

  const pick = (r: TitleRow) => {
    onSelect(r.id)
    if (phone) onOpenTitle(r.id)
    else {
      if (grid) setSummary(true)
      focusList()
    }
  }
  const items = grid ? (
    <TitleGrid rows={rows} index={index} loading={titles.isPending} grabs={grabs} now={now} selection={selection} phone={phone} gridRef={listRef} onPick={pick} />
  ) : (
    <TitleRows rows={rows} index={index} loading={titles.isPending} grabs={grabs} now={now} selection={selection} ticks={!phone || selection.active} phone={phone} listRef={listRef} onPick={pick} />
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
  const startSearch = (s: ManualSearchTarget) => current && setSearch({ ...s, titleId: current.id })
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

  if (phone) {
    const filtering = parsed.terms.filter((t) => menuTerms.has(t.name)).length
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <FilterStrip>
          <div className="flex w-full items-start gap-2">
            <div className="min-w-0 flex-1">{field}</div>
            <Button variant="secondary" size="small" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              {filtering > 0 ? `Filters ${filtering}` : 'Filters'}
            </Button>
          </div>
          <div className="w-full min-w-0">{tabs}</div>
          <div className="flex w-full items-center gap-2">
            <span className="label-12 min-w-0 flex-1 truncate text-gray-900 tabular-nums">
              {counted ? [...counted, sortLabel(sortOfQuery(parsed))].filter(Boolean).join(' · ') : <Skeleton width={96} height={14} />}
            </span>
            {switcher}
            {menu}
          </div>
        </FilterStrip>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {rows.length === 0 && !titles.isPending ? nothing : items}
          {bulk}
        </div>
      </div>
    )
  }

  const bar = (
    <TabStrip
      end={
        <>
          {switcher}
          {menu}
          <AddTitle onAdd={onAdd} />
        </>
      }
    >
      {tabs}
    </TabStrip>
  )
  const hints = (
    <span className="label-12 flex items-center gap-1 text-gray-900 pointer-coarse:hidden">
      <KeyboardInput small>j</KeyboardInput>
      <KeyboardInput small>k</KeyboardInput> move <KeyboardInput small>x</KeyboardInput> tick <KeyboardInput small>g</KeyboardInput> {grid ? 'list' : 'grid'}
    </span>
  )
  const closePage = () => {
    setOpened(false)
    requestAnimationFrame(focusList)
  }

  if (grid)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {bar}
        {gridPage ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {!searching && <PhoneBackHeader onBack={closePage}>{current.title}</PhoneBackHeader>}
            {titlePage(closePage)}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <FilterStrip>
                <div className="min-w-0 flex-1">{field}</div>
              </FilterStrip>
              <div className="relative flex min-h-0 flex-1 flex-col">
                {rows.length === 0 && !titles.isPending ? nothing : items}
                {bulk}
              </div>
              <PaneFooter>
                {hints}
                <span className="ml-auto">{count}</span>
              </PaneFooter>
            </div>
            {summary && current && (
              <TitleSummary
                key={current.id}
                ref={summaryRef}
                row={current}
                grabs={grabs.get(current.id) ?? []}
                now={now}
                onOpen={() => {
                  setOpened(true)
                  requestAnimationFrame(() => paneRef.current?.focus())
                }}
                onClose={() => {
                  setSummary(false)
                  focusList()
                }}
                onManualSearch={(s) => {
                  startSearch(s)
                  setOpened(true)
                }}
              />
            )}
          </div>
        )}
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {bar}
      <div className="flex min-h-0 flex-1">
        <WideListPane>
          {/* Not PaneHeader: it is a <header>, a second banner landmark that the shell's own tests (and a screen reader) count. */}
          <FilterStrip>
            <div className="w-full">{field}</div>
          </FilterStrip>
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

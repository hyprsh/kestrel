import { CheckSquare, Eraser, FolderInput, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles, useTitles, type TitleRow } from '../api/queries'
import { useOpenCleanup } from '../cleanup/launch'
import { Button, Collapse, EmptyState, Entity, KeyboardInput, Note, parseQuery } from '@hyprsh/design'
import { useKey, useListNav } from '../keys'
import { SelectionBar } from '../layout/SelectionBar'
import { useSelection } from '../selection'
import { FilterBar } from '../filter/FilterBar'
import { usePhone } from '../responsive'
import { FilterStrip } from '../layout/FilterStrip'
import { ListPane } from '../layout/ListPane'
import { PaneFooter } from '../layout/Pane'
import { PhoneBackHeader } from '../layout/PhoneBackHeader'
import { KindIcon, SlotDots } from './bits'
import { BulkActions } from './BulkActions'
import { filterLibrary, libraryQualifiers } from './filter'
import { ManualSearch } from './ManualSearch'
import { slotLabel } from './bits'
import { TickBox } from './TickBox'
import { TitleDetail, type ManualSearchTarget } from './TitleDetail'

/**
 * The Library: a filterable list on the left and the selected Title on the
 * right. Everything is reachable from the keyboard: j/k and the arrows move,
 * Enter steps into the detail, Escape steps back, `/` filters (with qualifiers
 * such as is:wanted, see ./filter.ts, kept in the address bar), x ticks the
 * Title under the cursor. While Titles are ticked, the right pane holds the
 * actions that change them together, and Escape clears the ticks.
 *
 * On a phone the list and the Title page are two screens: tapping a Title opens its page
 * full screen (`titleOpen`, kept by the Shell in the address bar so Back returns to the list),
 * and the filters sit in a row that opens and closes.
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
  const openCleanup = useOpenCleanup()
  const profiles = useProfiles().data
  const qualifiers = useMemo(() => libraryQualifiers((profiles ?? []).map((p) => ({ name: p.name, description: `${p.min_height}–${p.max_height}p` }))), [profiles])
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)

  const all = titles.data ?? []
  const rows = useMemo(() => filterLibrary(all, parseQuery(query, qualifiers), profiles ?? []), [all, query, qualifiers, profiles])
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selection = useSelection(ids)
  const index = Math.max(0, rows.findIndex((r) => r.id === selectedId)) // the first row until something is picked
  const current = rows[index] as TitleRow | undefined
  // A manual search replaces the detail pane; picking another Title in the list closes it.
  const [search, setSearch] = useState<(ManualSearchTarget & { titleId: number }) | null>(null)
  const searching = search !== null && search.titleId === current?.id

  // EntityList takes no ref, so the scroller holds it and the listbox is its one list.
  const focusList = () => listRef.current?.querySelector<HTMLElement>('[role=listbox]')?.focus()
  useEffect(focusList, [])
  useListNav('lib', rows.length, index, (i) => onSelect(rows[i].id), () => paneRef.current?.focus(), !searching)
  useKey(
    '/',
    (e) => {
      e.preventDefault()
      document.getElementById('library-filter')?.focus()
    },
    !searching,
  )
  useKey('x', () => current && selection.toggle(current.id), !searching)

  // Phone: the ticked Titles' actions are a screen of their own, reached from the selection bar.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(query !== '')
  useEffect(() => {
    if (selection.count === 0) setBulkOpen(false)
  }, [selection.count])

  const empty = titles.isSuccess && all.length === 0
  const tools = (
    <div className="flex gap-1">
      <Button variant="tertiary" size="small" prefix={<FolderInput />} onClick={onAdopt} aria-label="Adopt existing library" title="Adopt existing library">
        Adopt
      </Button>
      <Button variant="tertiary" size="small" prefix={<Eraser />} onClick={() => openCleanup()} aria-label="Clean up Unmanaged files" title="Clean up Unmanaged files">
        Clean up
      </Button>
      <Button
        variant={selection.active ? 'secondary' : 'tertiary'}
        size="small"
        prefix={<CheckSquare />}
        onClick={() => (selection.active ? selection.clear() : selection.setActive(true))}
        aria-pressed={selection.active}
        title="Tick Titles to change together (x)"
      >
        Tick
      </Button>
    </div>
  )
  const field = (
    <FilterBar
      id="library-filter"
      label="Filter the Library"
      placeholder="Filter, e.g. is:wanted  /"
      value={query}
      onChange={onQuery}
      qualifiers={qualifiers}
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

  const bulk = selection.count > 0 ? <BulkActions rows={rows.filter((r) => selection.has(r.id))} /> : null
  const title =
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
      <TitleDetail key={current.id} ref={paneRef} row={current} onEscape={focusList} onManualSearch={(s) => setSearch({ ...s, titleId: current.id })} />
    ) : (
      <div className="flex flex-1 items-center justify-center text-center">
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

  // A phone shows one screen: a Title's page (or the ticked Titles' actions) with a back button, or the list.
  const showBulk = phone && bulk !== null && bulkOpen
  if (phone && (showBulk || titleOpen)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {!(searching && !showBulk) && (
          <PhoneBackHeader onBack={showBulk ? () => setBulkOpen(false) : onCloseTitle}>{showBulk ? `${selection.count} ticked` : current?.title}</PhoneBackHeader>
        )}
        {showBulk ? bulk : title}
      </div>
    )
  }

  const count = (
    <span className="label-12 ml-auto shrink-0 text-gray-900">
      {rows.length} of {all.length}
    </span>
  )
  const list = (
    <>
      {phone ? (
        <FilterStrip>
          <div className="min-w-0 flex-1">
            <Collapse variant="inline" title={query && !filtersOpen ? `Filter: ${query}` : 'Filter'} expanded={filtersOpen} onChange={setFiltersOpen}>
              <div className="flex flex-col gap-2 pt-2">
                {field}
                {tools}
              </div>
            </Collapse>
          </div>
          {count}
        </FilterStrip>
      ) : (
        // Not PaneHeader: it is a <header>, a second banner landmark that the shell's own tests (and a screen reader) count.
        <FilterStrip>
          {tools}
          <div className="w-full">{field}</div>
        </FilterStrip>
      )}
      {selection.active && (
        <FilterStrip>
          <SelectionBar selection={selection} shown={rows.length}>
            {phone && selection.count > 0 && (
              <Button variant="primary" size="small" onClick={() => setBulkOpen(true)}>
                Change {selection.count}
              </Button>
            )}
          </SelectionBar>
        </FilterStrip>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
        <Entity.List
          role="listbox"
          aria-label="Library"
          aria-activedescendant={current ? `title-${current.id}` : undefined}
          tabIndex={0}
          className="outline-none"
          onClick={(e) => {
            // One handler for the listbox: rows are plain options, so Tab has one stop and aria-activedescendant stays valid.
            const id = (e.target as Element).closest('[role="option"]')?.id
            const r = rows.find((x) => `title-${x.id}` === id)
            if (!r) return
            onSelect(r.id)
            if (phone) onOpenTitle(r.id)
            else focusList()
          }}
        >
          {rows.map((r, i) => (
            <Entity
              key={r.id}
              as="li"
              id={`title-${r.id}`}
              role="option"
              aria-selected={i === index}
              current={i === index && !phone}
              data-nav={`lib-${i}`}
              className="max-sm:min-h-12"
              left={
                <>
                  {selection.active && <TickBox selection={selection} id={r.id} name={r.title} />}
                  <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
                </>
              }
              right={<SlotDots slots={r.slots} />}
            >
              <Entity.Content
                fill
                title={
                  <span className="truncate">
                    {r.title}
                    {r.year ? <span className="ml-1.5 font-normal text-gray-900">{r.year}</span> : null}
                  </span>
                }
                description={r.primary_title !== r.title ? <span data-primary-title>{r.primary_title}</span> : undefined}
              />
            </Entity>
          ))}
        </Entity.List>
      </div>

      {!phone && (
        <PaneFooter>
          <span className="label-12 flex items-center gap-1 text-gray-900 pointer-coarse:hidden">
            <KeyboardInput small>j</KeyboardInput>
            <KeyboardInput small>k</KeyboardInput> move <KeyboardInput small>x</KeyboardInput> tick
          </span>
          {count}
        </PaneFooter>
      )}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1">
      {phone ? <aside className="flex min-w-0 flex-1 flex-col">{list}</aside> : <ListPane>{list}</ListPane>}

      {!phone && (bulk ?? title)}
    </div>
  )
}

import { CheckSquare, Eraser, FolderInput, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfiles, useTitles, type TitleRow } from '../api/queries'
import { useOpenCleanup } from '../cleanup/launch'
import { Button, EmptyState, KeyboardInput, Note } from '@hyprsh/design'
import { useKey, useListNav } from '../keys'
import { SelectionBar, useSelection } from '../selection'
import { parse } from '../filter/query'
import { QueryField } from '../filter/QueryField'
import { cx } from '../ui'
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
 */
export function Library({
  selectedId,
  onSelect,
  onAdd,
  onAdopt,
  query,
  onQuery,
}: {
  selectedId: number | null
  onSelect: (id: number) => void
  onAdd: () => void
  onAdopt: () => void
  /** The filter field's text, kept by the Shell so it can live in the address bar. */
  query: string
  onQuery: (query: string) => void
}) {
  const titles = useTitles()
  const openCleanup = useOpenCleanup()
  const profiles = useProfiles().data
  const qualifiers = useMemo(() => libraryQualifiers((profiles ?? []).map((p) => p.name)), [profiles])
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)

  const all = titles.data ?? []
  const rows = useMemo(() => filterLibrary(all, parse(query, qualifiers), profiles ?? []), [all, query, qualifiers, profiles])
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selection = useSelection(ids)
  const index = Math.max(0, rows.findIndex((r) => r.id === selectedId)) // the first row until something is picked
  const current = rows[index] as TitleRow | undefined
  // A manual search replaces the detail pane; picking another Title in the list closes it.
  const [search, setSearch] = useState<(ManualSearchTarget & { titleId: number }) | null>(null)
  const searching = search !== null && search.titleId === current?.id

  const focusList = () => listRef.current?.focus()
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

  const empty = titles.isSuccess && all.length === 0
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-alpha-400">
        <div className="flex flex-col gap-2 border-b border-gray-alpha-400 p-3">
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
          <QueryField
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
          <SelectionBar selection={selection} shown={rows.length} />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Library"
          aria-activedescendant={current ? `title-${current.id}` : undefined}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto p-1.5 outline-none"
        >
          {rows.map((r, i) => (
            <div
              key={r.id}
              id={`title-${r.id}`}
              role="option"
              aria-selected={i === index}
              data-nav={`lib-${i}`}
              onClick={() => {
                onSelect(r.id)
                focusList()
              }}
              className={cx('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5', i === index ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100')}
            >
              {selection.active && <TickBox selection={selection} id={r.id} name={r.title} />}
              <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
              <div className="min-w-0 flex-1">
                <div className="label-14 truncate">
                  {r.title}
                  {r.year ? <span className="ml-1.5 text-gray-900">{r.year}</span> : null}
                </div>
                {r.primary_title !== r.title && (
                  <div data-primary-title className="label-12 truncate text-gray-900">
                    {r.primary_title}
                  </div>
                )}
              </div>
              <SlotDots slots={r.slots} />
            </div>
          ))}
        </div>

        <footer className="label-12 flex items-center justify-between border-t border-gray-alpha-400 px-3 py-2 text-gray-900">
          <span className="flex items-center gap-1">
            <KeyboardInput small>j</KeyboardInput>
            <KeyboardInput small>k</KeyboardInput> move <KeyboardInput small>x</KeyboardInput> tick
          </span>
          <span>
            {rows.length} of {all.length}
          </span>
        </footer>
      </aside>

      {selection.count > 0 ? (
        <BulkActions rows={rows.filter((r) => selection.has(r.id))} />
      ) : current && searching ? (
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
      )}
    </div>
  )
}

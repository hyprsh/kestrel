import { CheckSquare, Eraser, FolderInput, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTitles, type TitleRow } from '../api/queries'
import { useOpenCleanup } from '../cleanup/launch'
import { Button } from '../forms'
import { useKey, useListNav } from '../keys'
import { SelectBox, SelectionBar, useSelection } from '../selection'
import { cx, Kbd } from '../ui'
import { KindIcon, SlotDots } from './bits'
import { BulkActions } from './BulkActions'
import { ManualSearch } from './ManualSearch'
import { slotLabel } from './bits'
import { TitleDetail, type ManualSearchTarget } from './TitleDetail'

type Kind = 'all' | 'movie' | 'series'
const kinds: { key: Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'series', label: 'Series' },
]

/** What the Library list is narrowed to besides text and kind. */
export type Preset = 'wanted' | 'long_missing'

/** A Title is Wanted when any of its Versions is; Long Missing when any is long missing. */
const hasSlot = (r: TitleRow, test: (s: NonNullable<TitleRow['slots']['standard']>) => boolean) =>
  [r.slots.standard, r.slots['4k']].some((s) => s !== null && test(s))

const norm = (s: string) => s.toLowerCase()

function matches(r: TitleRow, text: string): boolean {
  const t = norm(text.trim())
  return t === '' || norm(r.title).includes(t) || norm(r.primary_title).includes(t)
}

/**
 * The Library: a filterable list on the left and the selected Title on the
 * right. Everything is reachable from the keyboard: j/k and the arrows move,
 * Enter steps into the detail, Escape steps back, `/` filters, x ticks the
 * Title under the cursor. While Titles are ticked, the right pane holds the
 * actions that change them together, and Escape clears the ticks.
 */
const toolButton = 'flex h-6 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000'

export function Library({
  selectedId,
  onSelect,
  onAdd,
  onAdopt,
  preset,
}: {
  selectedId: number | null
  onSelect: (id: number) => void
  onAdd: () => void
  onAdopt: () => void
  /** Opens with the Wanted filter on, and the Long Missing chip too for 'long_missing'. */
  preset?: Preset
}) {
  const titles = useTitles()
  const openCleanup = useOpenCleanup()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [wanted, setWanted] = useState(preset !== undefined)
  const [longMissing, setLongMissing] = useState(preset === 'long_missing')
  const [byWantedSince, setByWantedSince] = useState(preset !== undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const all = titles.data ?? []
  const rows = useMemo(() => {
    const kept = all.filter(
      (r) =>
        (kind === 'all' || r.kind === kind) &&
        matches(r, text) &&
        (!wanted || hasSlot(r, (s) => s.state === 'wanted')) &&
        (!longMissing || hasSlot(r, (s) => s.long_missing)),
    )
    if (!byWantedSince) return kept
    // Wanted longest first; Titles that are not Wanted keep their order, last.
    return [...kept].sort((a, b) => {
      if (a.wanted_since === null || b.wanted_since === null) return a.wanted_since === b.wanted_since ? 0 : a.wanted_since === null ? 1 : -1
      return a.wanted_since.localeCompare(b.wanted_since)
    })
  }, [all, kind, text, wanted, longMissing, byWantedSince])
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
      filterRef.current?.focus()
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
            <button onClick={onAdopt} aria-label="Adopt existing library" title="Adopt existing library" className={toolButton}>
              <FolderInput className="size-3.5" />
              Adopt
            </button>
            <button onClick={() => openCleanup()} aria-label="Clean up Unmanaged files" title="Clean up Unmanaged files" className={toolButton}>
              <Eraser className="size-3.5" />
              Clean up
            </button>
            <button
              onClick={() => (selection.active ? selection.clear() : selection.setActive(true))}
              aria-pressed={selection.active}
              title="Tick Titles to change together (x)"
              className={cx(toolButton, selection.active && 'bg-gray-alpha-200 text-gray-1000')}
            >
              <CheckSquare className="size-3.5" />
              Tick
            </button>
          </div>
          <div className="relative">
            <input
              ref={filterRef}
              type="text"
              aria-label="Filter the Library"
              placeholder="Filter"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const next = Math.min(Math.max(index + (e.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)
                  if (rows[next]) onSelect(rows[next].id)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setText('')
                  focusList()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  focusList()
                }
              }}
              className="h-8 w-full rounded-md border border-gray-alpha-400 bg-background-100 px-2.5 pr-8 text-[13px] outline-none focus:border-gray-700"
            />
            <span className="pointer-events-none absolute top-1.5 right-2">
              <Kbd>/</Kbd>
            </span>
          </div>
          <div role="group" aria-label="Kind" className="flex gap-1">
            {kinds.map((k) => (
              <button
                key={k.key}
                aria-pressed={kind === k.key}
                onClick={() => setKind(k.key)}
                className={cx(
                  'h-6 rounded-md px-2 text-[12px] font-medium',
                  kind === k.key ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Filters" className="flex flex-wrap gap-1">
            <button
              aria-pressed={wanted}
              onClick={() => {
                setWanted(!wanted)
                if (wanted) setLongMissing(false) // Long Missing is a narrowing of Wanted
              }}
              className={cx(
                'h-6 rounded-md px-2 text-[12px] font-medium',
                wanted ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100',
              )}
            >
              Wanted
            </button>
            {wanted && (
              <button
                aria-pressed={longMissing}
                onClick={() => setLongMissing(!longMissing)}
                className={cx(
                  'h-6 rounded-md px-2 text-[12px] font-medium',
                  longMissing ? 'bg-red-200 text-red-900' : 'text-gray-900 hover:bg-gray-alpha-100',
                )}
              >
                Long Missing
              </button>
            )}
            <button
              aria-pressed={byWantedSince}
              onClick={() => setByWantedSince(!byWantedSince)}
              className={cx(
                'h-6 rounded-md px-2 text-[12px] font-medium',
                byWantedSince ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100',
              )}
            >
              Sort by Wanted since
            </button>
          </div>
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
              {selection.active && <SelectBox selection={selection} id={r.id} name={r.title} />}
              <KindIcon kind={r.kind} className="shrink-0 text-gray-900" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {r.title}
                  {r.year ? <span className="ml-1.5 font-normal text-gray-900">{r.year}</span> : null}
                </div>
                {r.primary_title !== r.title && (
                  <div data-primary-title className="truncate text-[12px] text-gray-900">
                    {r.primary_title}
                  </div>
                )}
              </div>
              <SlotDots slots={r.slots} />
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between border-t border-gray-alpha-400 px-3 py-2 text-[12px] text-gray-900">
          <span className="flex items-center gap-1">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move <Kbd>x</Kbd> tick
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
            <p role="alert" className="text-[12px] text-red-900">
              Could not load the Library.
            </p>
          ) : empty ? (
            <div>
              <div className="text-sm font-medium">Nothing here yet</div>
              <div className="mt-1 text-gray-900">Add your first Movie or Series.</div>
              <Button className="mt-3" onClick={onAdd}>
                <Plus className="mr-1 size-4" />
                Add a title
              </Button>
            </div>
          ) : titles.isSuccess ? (
            <div className="text-gray-900">No Title matches.</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

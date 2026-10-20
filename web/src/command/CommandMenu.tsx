import { CornerDownLeft, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ApiError, useLookup, useTitles, type LookupResult } from '../api/queries'
import { KindIcon } from '../library/bits'
import { scoreText } from '../library/Score'
import { Badge, cx, Kbd } from '../ui'
import { AddConfirm } from './AddConfirm'

export type MenuMode = 'root' | 'add'

export type MenuAction = { id: string; label: string; keywords?: string; run: () => void }
export type MenuTarget = { id: string; label: string }

type Item = {
  id: string
  group: 'Actions' | 'Go to' | 'Titles' | 'Add'
  label: string
  sub?: string
  keywords?: string
  right?: ReactNode
  disabled?: boolean
  /** Items that change the menu itself, or close it on their own, leave it open when run. */
  keepOpen?: boolean
  run: () => void
}

/** Waits for typing to pause before a value is used, so a search is not sent per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The ⌘K menu: go anywhere, run an action, jump to a Title, or Add one with a
 * single search across both kinds. In Add mode a result opens the add panel;
 * results already in the Library open that Title instead.
 */
export function CommandMenu({
  initialMode,
  actions,
  places,
  onClose,
  onGo,
  onOpenTitle,
}: {
  initialMode: MenuMode
  actions: MenuAction[]
  places: MenuTarget[]
  onClose: () => void
  onGo: (place: string) => void
  onOpenTitle: (id: number) => void
}) {
  const [mode, setMode] = useState<MenuMode>(initialMode)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [chosen, setChosen] = useState<LookupResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titles = useTitles()

  useEffect(() => {
    if (!chosen) inputRef.current?.focus()
  }, [chosen, mode])

  const debounced = useDebounced(query, 250)
  const lookup = useLookup(mode === 'add' ? debounced : '')
  const searching = mode === 'add' && query.trim() !== '' && !lookup.isError && (query !== debounced || lookup.isFetching)

  const items: Item[] = useMemo(() => {
    if (mode === 'add') {
      return (lookup.data ?? []).map((r) => ({
        id: `${r.kind}-${r.tmdb_id}`,
        group: 'Titles' as const,
        label: r.title,
        sub: [r.year, scoreText(r.ratings)].filter(Boolean).join(' · ') || undefined,
        disabled: !r.addable,
        keepOpen: true,
        right: (
          <span className="flex items-center gap-1.5">
            {r.in_library !== null && <Badge tone="green">In library</Badge>}
            {!r.addable && r.not_addable_reason === 'not_on_tvdb' && <Badge tone="amber">Not on TheTVDB</Badge>}
            {!r.addable && r.not_addable_reason === 'tvdb_unavailable' && <Badge tone="amber">TheTVDB unreachable</Badge>}
            <Badge>{r.kind === 'series' ? 'Series' : 'Movie'}</Badge>
          </span>
        ),
        run: () => {
          if (r.in_library !== null) {
            onOpenTitle(r.in_library)
            onClose()
          } else {
            setChosen(r)
          }
        },
      }))
    }
    const q = query.trim().toLowerCase()
    const hit = (i: { label: string; keywords?: string }) => q === '' || `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(q)
    const addAction: Item = {
      id: 'action-add',
      group: 'Actions',
      label: 'Add Title…',
      keywords: 'movie series new search',
      keepOpen: true,
      run: () => {
        setQuery('')
        setMode('add')
      },
    }
    const act: Item[] = [addAction, ...actions.map((a) => ({ id: `action-${a.id}`, group: 'Actions' as const, label: a.label, keywords: a.keywords, run: a.run }))].filter(hit)
    const go: Item[] = places
      .map((p) => ({ id: `go-${p.id}`, group: 'Go to' as const, label: p.label, run: () => onGo(p.id) }))
      .filter(hit)
    const own: Item[] =
      q === ''
        ? []
        : (titles.data ?? [])
            .filter((t) => `${t.title} ${t.primary_title}`.toLowerCase().includes(q))
            .slice(0, 6)
            .map((t) => ({
              id: `title-${t.id}`,
              group: 'Titles' as const,
              label: t.title,
              sub: t.year ? String(t.year) : undefined,
              right: <KindIcon kind={t.kind} className="text-gray-900" />,
              run: () => onOpenTitle(t.id),
            }))
    const add: Item[] =
      q === ''
        ? []
        : [{ id: 'add-query', group: 'Add', label: `Add "${query.trim()}"…`, keepOpen: true, run: () => setMode('add') }]
    return q === '' ? [...act, ...go] : [...own, ...go, ...act, ...add]
  }, [mode, query, lookup.data, actions, places, titles.data, onGo, onOpenTitle, onClose])

  const index = Math.min(sel, Math.max(items.length - 1, 0))

  const run = (item: Item | undefined) => {
    if (!item || item.disabled) return
    item.run()
    if (!item.keepOpen) onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (chosen) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setChosen(null)
      }
      return // the panel handles the rest
    }
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      setSel(Math.min(Math.max(index + (down ? 1 : -1), 0), Math.max(items.length - 1, 0)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && mode === 'add' && query === '') {
      e.preventDefault()
      setMode('root')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        data-cmdk
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onKeyDown={onKeyDown}
        className="flex max-h-[70vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-gray-alpha-400 bg-background-100 shadow-2xl"
      >
        {chosen ? (
          <AddConfirm
            result={chosen}
            onBack={() => setChosen(null)}
            onAdded={(id) => {
              onOpenTitle(id)
              onClose()
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-gray-alpha-400 px-3">
              {mode === 'add' && <Badge tone="blue">Add</Badge>}
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls="cmdk-list"
                aria-label={mode === 'add' ? 'Search a Movie or Series to add' : 'Search or run a command'}
                placeholder={mode === 'add' ? 'Search a Movie or Series to add…' : 'Search or run a command…'}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSel(0)
                }}
                className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-gray-700"
              />
            </div>
            <div id="cmdk-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-auto p-1.5">
              {mode === 'add' && query.trim() === '' && <Hint>Type a title to search both Movies and Series.</Hint>}
              {mode === 'add' && lookup.isError && (
                <p role="alert" className="px-3 py-3 text-[12px] text-red-900">
                  {lookup.error instanceof ApiError ? lookup.error.message : 'The search failed.'}
                </p>
              )}
              {searching && items.length === 0 && !lookup.isError && <Hint>Searching…</Hint>}
              {mode === 'add' && lookup.isSuccess && items.length === 0 && <Hint>No results.</Hint>}
              {items.map((item, i) => (
                <div key={item.id}>
                  {(i === 0 || items[i - 1].group !== item.group) && mode === 'root' && (
                    <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-gray-900">{item.group === 'Add' ? 'Add' : item.group}</div>
                  )}
                  <div
                    role="option"
                    aria-selected={i === index}
                    aria-disabled={item.disabled || undefined}
                    onMouseMove={() => setSel(i)}
                    onClick={() => run(item)}
                    className={cx(
                      'flex h-9 cursor-default items-center gap-2 rounded-md px-2.5',
                      i === index && 'bg-gray-alpha-200',
                      item.disabled && 'opacity-50',
                    )}
                  >
                    {item.group === 'Add' && <Plus className="size-3.5 text-gray-900" />}
                    <span className="truncate text-[13px]">{item.label}</span>{' '}
                    {item.sub && <span className="text-[12px] text-gray-900">{item.sub}</span>}{' '}
                    <span className="ml-auto">{item.right}</span>
                  </div>
                </div>
              ))}
            </div>
            <footer className="flex items-center gap-3 border-t border-gray-alpha-400 px-3 py-2 text-[12px] text-gray-900">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>{' '}
                select
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> close
              </span>
              {mode === 'add' && (
                <span className="flex items-center gap-1">
                  <Kbd>⌫</Kbd> back
                </span>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-[12px] text-gray-900">{children}</p>
}

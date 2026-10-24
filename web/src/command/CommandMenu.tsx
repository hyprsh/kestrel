// chrome: pending
import { Badge, CommandMenu as DesignCommandMenu, CommandMenuGroup, CommandMenuInput, CommandMenuItem, CommandMenuList, KeyboardInput, Note, type CommandMenuKeyEvent } from '@hyprsh/design'
import { CornerDownLeft, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, useLookup, useTitles, type LookupResult, type TitleRow } from '../api/queries'
import { rank, type Match } from '../fuzzy'
import { KindIcon } from '../library/bits'
import { ratingsText } from '../library/Ratings'
import { AddConfirm } from './AddConfirm'
import { Poster, TitlePoster } from '../poster'

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
  /** The parts of the label the query matched, marked. */
  marks?: [number, number][]
  /** An icon before the label. */
  icon?: ReactNode
  /** A Title's poster thumbnail, drawn in the taller row. */
  thumb?: ReactNode
}

/** The size of a row's poster thumbnail. */
const thumbSize = 'h-10 w-7 rounded-sm'

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
  const [chosen, setChosen] = useState<LookupResult | null>(null)
  const titles = useTitles()
  const inputRef = useRef<HTMLInputElement>(null)

  // The input is gone while the add panel shows and the menu does not refocus it, and a click on a row takes focus off it.
  useEffect(() => {
    if (!chosen) inputRef.current?.focus()
  }, [chosen, mode])

  const debounced = useDebounced(query, 250)
  const lookup = useLookup(mode === 'add' ? debounced : '')
  const searching = mode === 'add' && query.trim() !== '' && !lookup.isError && (query !== debounced || lookup.isFetching)

  const items: Item[] = useMemo(() => {
    if (mode === 'add') {
      const found: Item[] = (lookup.data?.items ?? []).map((r) => ({
        id: `${r.kind}-${r.tmdb_id}`,
        group: 'Titles' as const,
        label: r.title,
        sub: [r.year, ratingsText(r.ratings)].filter(Boolean).join(' · ') || undefined,
        disabled: !r.addable,
        keepOpen: true,
        thumb: <Poster src={r.poster} className={thumbSize} />,
        right: (
          <span className="flex items-center gap-1.5">
            {r.in_library !== null && <Badge variant="green-subtle" size="sm">In library</Badge>}
            {!r.addable && r.not_addable_reason === 'not_on_tvdb' && <Badge variant="amber-subtle" size="sm">Not on TheTVDB</Badge>}
            {!r.addable && r.not_addable_reason === 'tvdb_unavailable' && <Badge variant="amber-subtle" size="sm">TheTVDB unreachable</Badge>}
            <Badge variant="gray-subtle" size="sm">{r.kind === 'series' ? 'Series' : 'Movie'}</Badge>
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
      // A best result far from what was typed is offered first as the query to search for instead.
      const meant = lookup.data?.did_you_mean
      if (!meant) return found
      const retry: Item = {
        id: 'did-you-mean',
        group: 'Add',
        label: `Did you mean ${meant}?`,
        icon: <Search aria-hidden className="size-4 text-gray-900" />,
        keepOpen: true,
        run: () => setQuery(meant),
      }
      return [retry, ...found]
    }
    const q = query.trim()
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
    const act: Item[] = [addAction, ...actions.map((a) => ({ id: `action-${a.id}`, group: 'Actions' as const, label: a.label, keywords: a.keywords, run: a.run }))]
    const go: Item[] = places.map((p) => ({ id: `go-${p.id}`, group: 'Go to' as const, label: p.label, run: () => onGo(p.id) }))
    if (q === '') return [...act, ...go]
    const title = (t: TitleRow): Item => ({
      id: `title-${t.id}`,
      group: 'Titles',
      label: t.title,
      sub: t.year ? String(t.year) : undefined,
      thumb: <TitlePoster id={t.id} hasPoster={t.has_poster} className={thumbSize} />,
      right: <KindIcon kind={t.kind} className="text-gray-900" />,
      run: () => onOpenTitle(t.id),
    })
    // Marks show only where the label itself matched, not an alias or a keyword.
    const marked = <T,>(hits: { item: T; field: number; match: Match }[], toItem: (t: T) => Item) =>
      hits.map((h) => ({ score: h.match.score, item: { ...toItem(h.item), marks: h.field === 0 ? h.match.ranges : undefined } }))
    const groups = [
      marked(rank(q, titles.data ?? [], (t) => [t.title, t.primary_title]).slice(0, 6), title),
      marked(rank(q, go, (i) => [i.label]), (i) => i),
      marked(rank(q, act, (i) => [i.label, i.keywords ?? '']), (i) => i),
    ]
      .filter((g) => g.length > 0)
      .sort((a, b) => b[0].score - a[0].score) // the group holding the best match first; ties keep this order
    const add: Item = {
      id: 'add-query',
      group: 'Add',
      label: `Add "${q}"…`,
      icon: <Plus aria-hidden className="size-4 text-gray-900" />,
      keepOpen: true,
      run: () => setMode('add'),
    }
    return [...groups.flatMap((g) => g.map((h) => h.item)), add]
  }, [mode, query, lookup.data, actions, places, titles.data, onGo, onOpenTitle, onClose])

  const onKeyDown = (e: CommandMenuKeyEvent) => {
    // In the add panel Escape goes back to the list; every other key keeps its native behaviour.
    if (chosen) {
      if (e.key === 'Escape') {
        e.skipMenu()
        setChosen(null)
      }
      return
    }
    // Going back from an empty Add query. preventDefault also tells the menu to leave the key alone.
    if (e.key === 'Backspace' && mode === 'add' && query === '') {
      e.preventDefault()
      setMode('root')
    }
  }

  // Rows in runs of one group; only the root menu names its groups.
  const runs: { group: Item['group']; items: Item[] }[] = []
  for (const item of items) {
    const last = runs[runs.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else runs.push({ group: item.group, items: [item] })
  }
  const row = (item: Item) => (
    <CommandMenuItem
      key={item.id}
      value={item.label}
      prefix={item.thumb ?? item.icon}
      suffix={item.right}
      disabled={item.disabled}
      keepOpen={item.keepOpen}
      callback={item.run}
      className={item.thumb !== undefined ? 'h-12' : undefined}
    >
      <span className="truncate">
        <Marked text={item.label} ranges={item.marks ?? []} />
      </span>{' '}
      {item.sub && <span className="label-13 ml-1 text-gray-900">{item.sub}</span>}
    </CommandMenuItem>
  )

  return (
    <DesignCommandMenu
      open
      onOpenChange={(open) => !open && onClose()}
      label="Command menu"
      hotkey={false} // the Shell owns ⌘K
      query={query}
      onQueryChange={setQuery}
      shouldFilter={false} // items are ranked and marked here
      onKeyDown={onKeyDown}
      inputRef={inputRef}
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
          <CommandMenuInput
            prefix={mode === 'add' ? <Badge variant="blue-subtle" size="sm">Add</Badge> : undefined}
            aria-label={mode === 'add' ? 'Search a Movie or Series to add' : 'Search or run a command'}
            placeholder={mode === 'add' ? 'Search a Movie or Series to add…' : 'Search or run a command…'}
          />
          <CommandMenuList
            loading={searching && items.length === 0 && !lookup.isError}
            empty={
              lookup.isError ? (
                <Note variant="error" size="small">
                  {lookup.error instanceof ApiError ? lookup.error.message : 'The search failed.'}
                </Note>
              ) : undefined
            }
          >
            {mode === 'add' && query.trim() === '' && <Hint>Type a title to search both Movies and Series.</Hint>}
            {mode === 'add' ? items.map(row) : runs.map((r, i) => (
              <CommandMenuGroup key={`${r.group}-${i}`} heading={r.group}>
                {r.items.map(row)}
              </CommandMenuGroup>
            ))}
          </CommandMenuList>
          <footer className="label-13 flex items-center gap-3 border-t border-gray-alpha-400 px-3 py-2 text-gray-900 pointer-coarse:hidden">
            <span className="flex items-center gap-1">
              <KeyboardInput small>↑</KeyboardInput>
              <KeyboardInput small>↓</KeyboardInput> move
            </span>
            <span className="flex items-center gap-1">
              <KeyboardInput small>
                <CornerDownLeft aria-hidden className="size-3" />
              </KeyboardInput>{' '}
              select
            </span>
            <span className="flex items-center gap-1">
              <KeyboardInput small>Esc</KeyboardInput> close
            </span>
            {mode === 'add' && (
              <span className="flex items-center gap-1">
                <KeyboardInput small>⌫</KeyboardInput> back
              </span>
            )}
          </footer>
        </>
      )}
    </DesignCommandMenu>
  )
}

/** A label with the matched parts in a mark. */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    parts.push(text.slice(at, a), <mark key={a} className="bg-transparent font-semibold text-gray-1000">{text.slice(a, b)}</mark>)
    at = b
  }
  parts.push(text.slice(at))
  return parts
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="label-13 px-3 py-3 text-gray-900">{children}</p>
}

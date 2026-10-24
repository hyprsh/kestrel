import { Badge, CommandMenu as DesignCommandMenu, CommandMenuGroup, CommandMenuInput, CommandMenuItem, CommandMenuList, Note, type CommandMenuKeyEvent } from '@hyprsh/design'
import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, useLookup, useTitles, type LookupResult, type TitleRow } from '../api/queries'
import { rank } from '../fuzzy'
import { KindIcon } from '../library/bits'
import { ratingsText } from '../library/Ratings'
import { AddConfirm } from './AddConfirm'
import { PosterThumb, TitlePosterThumb } from './PosterThumb'
import { useAfter } from '../loading'

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
  /** An icon before the label. */
  icon?: ReactNode
  /** A Title's poster thumbnail, drawn in the taller row. */
  thumb?: ReactNode
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

  // A quick answer shows no loading line at all.
  const showLoading = useAfter(300, searching)

  const items: Item[] = useMemo(() => {
    if (mode === 'add') {
      const found: Item[] = (lookup.data?.items ?? []).map((r) => ({
        id: `${r.kind}-${r.tmdb_id}`,
        group: 'Titles' as const,
        label: r.title,
        sub: [r.year, ratingsText(r.ratings)].filter(Boolean).join(' · ') || undefined,
        disabled: !r.addable,
        keepOpen: true,
        thumb: <PosterThumb src={r.poster} />,
        right: (
          <span className="flex items-center gap-1.5">
            {r.in_library !== null && <Badge variant="green" contrast="low" size="sm">In library</Badge>}
            {!r.addable && r.not_addable_reason === 'not_on_tvdb' && <Badge variant="amber" contrast="low" size="sm">Not on TheTVDB</Badge>}
            {!r.addable && r.not_addable_reason === 'tvdb_unavailable' && <Badge variant="amber" contrast="low" size="sm">TheTVDB unreachable</Badge>}
            <Badge variant="gray" contrast="low" size="sm">{r.kind === 'series' ? 'Series' : 'Movie'}</Badge>
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
      thumb: <TitlePosterThumb id={t.id} hasPoster={t.has_poster} />,
      right: <KindIcon kind={t.kind} className="text-gray-900" />,
      run: () => onOpenTitle(t.id),
    })
    const scored = <T,>(hits: { item: T; match: { score: number } }[], toItem: (t: T) => Item) => hits.map((h) => ({ score: h.match.score, item: toItem(h.item) }))
    const groups = [
      scored(rank(q, titles.data ?? [], (t) => [t.title, t.primary_title]).slice(0, 6), title),
      scored(rank(q, go, (i) => [i.label]), (i) => i),
      scored(rank(q, act, (i) => [i.label, i.keywords ?? '']), (i) => i),
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
    >
      <span className="truncate">{item.label}</span>{' '}
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
            prefix={mode === 'add' ? <Badge variant="blue" contrast="low" size="sm">Add</Badge> : undefined}
            aria-label={mode === 'add' ? 'Search a Movie or Series to add' : 'Search or run a command'}
            placeholder={mode === 'add' ? 'Type a title to search both Movies and Series…' : 'Search or run a command…'}
          />
          <CommandMenuList
            loading={showLoading && searching && items.length === 0 && !lookup.isError}
            empty={
              lookup.isError ? (
                <Note variant="error" size="small">
                  {lookup.error instanceof ApiError ? lookup.error.message : 'The search failed.'}
                </Note>
              ) : undefined
            }
          >
            {mode === 'add' ? items.map(row) : runs.map((r, i) => (
              <CommandMenuGroup key={`${r.group}-${i}`} heading={r.group}>
                {r.items.map(row)}
              </CommandMenuGroup>
            ))}
          </CommandMenuList>
        </>
      )}
    </DesignCommandMenu>
  )
}

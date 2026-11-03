import { Button, CommandMenu as DesignCommandMenu, CommandMenuGroup, CommandMenuInput, CommandMenuList, Note, useToasts, type CommandMenuKeyEvent } from '@hyprsh/design'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Command, Eraser, FolderInput, LogOut, Plus, Search, SunMoon, Wand } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, lookupDetailQuery, useCreateTitle, useLookup, useProfiles, useTitles, type LookupResult, type TitleRow } from '../api/queries'
import { rank } from '../fuzzy'
import { useSlotNames } from '../library/slots'
import { Poster, TitlePoster } from '../poster'
import { useAfter, useDebounced } from '../loading'
import { usePhone } from '../responsive'
import { shownState } from '../ui/slotState'
import { AddFlow, useChoiceLabel, type Added, type Choice } from './AddFlow'
import { allEpisodes, createBody, monitorClause, pickedFrom, resultLine, versionsOf } from './addModel'
import { Hints, Row } from './Rows'

export type MenuMode = 'root' | 'add'

export type MenuAction = { id: string; label: string; keywords?: string; run: () => void }
export type MenuTarget = { id: string; label: string; icon?: ReactNode }

/** What a command does, under its name. */
const actionNotes: Record<string, string> = {
  'search-wanted': 'Ask the indexers now',
  theme: 'Light, dark or the system’s',
  setup: 'Walk through the setup again',
  adopt: 'Bring in files already on disk',
  cleanup: 'Samples, subtitles and other leftovers',
  logout: 'End this session',
}

const actionIcons: Record<string, ReactNode> = {
  'search-wanted': <Search />,
  theme: <SunMoon />,
  setup: <Wand />,
  adopt: <FolderInput />,
  cleanup: <Eraser />,
  logout: <LogOut />,
}

type Entry = { id: string; label: string; keywords?: string; node: ReactNode }

/** A Library Title's state in a word or two: "6 Wanted · Downloading", "Have". */
function stateLine(t: TitleRow): string {
  const states = t.slot_states.map((v) => shownState(v.state as string, t.monitored))
  const parts: string[] = []
  if (t.kind === 'series') {
    const wanted = t.wanted_episodes?.wanted ?? 0
    if (wanted > 0) parts.push(`${wanted} Wanted`)
  } else if (states.includes('wanted')) parts.push('Wanted')
  if (states.includes('downloading')) parts.push('Downloading')
  if (parts.length === 0)
    parts.push(states.length > 0 && states.every((s) => s === 'unmonitored') ? 'Not Monitored' : states.includes('unreleased') ? 'Not Out Yet' : states.includes('filled') ? 'Have' : 'Nothing Yet')
  return [t.kind === 'series' ? 'Series' : 'Movie', ...parts].join(' · ')
}

/**
 * The ⌘K menu: one stack of same-size rows. The empty menu lists Recent Titles, Actions and Go To; typing searches the Library, the
 * commands and TMDB together. A TMDB result is a page inside the menu (see AddFlow) whose choices each open their own list, and
 * Esc goes back one level, closing at the root. A result already in the Library opens that Title instead.
 */
// chrome-ok: the Kestrel screen that fills the design CommandMenu with its Titles and actions, not a copy of it
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
  const phone = usePhone()
  const [mode, setMode] = useState<MenuMode>(initialMode)
  const [query, setQuery] = useState('')
  // The page of a TMDB result and the lists opened from it; null is the root. The root's query waits in `saved`.
  const [flow, setFlow] = useState<{ result: LookupResult; trail: Choice[] } | null>(null)
  const [saved, setSaved] = useState('')
  const titles = useTitles()
  const profiles = useProfiles()
  const slots = useSlotNames()
  const choiceLabel = useChoiceLabel()
  const create = useCreateTitle()
  const toasts = useToasts()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<(() => void) | null>(null)

  // A row click takes focus off the input, and the input is gone while a page or list shows: back at the root it is refocused.
  useEffect(() => {
    if (!flow) inputRef.current?.focus()
  }, [flow, mode])

  const debounced = useDebounced(query, 250)
  const lookup = useLookup(flow ? '' : debounced)
  const searching = !flow && query.trim() !== '' && !lookup.isError && (query !== debounced || lookup.isFetching)
  // A quick answer shows no loading line at all.
  const showLoading = useAfter(300, searching)

  const open = (r: LookupResult) => setFlow({ result: r, trail: [] })
  const push = (c: Choice) => {
    setQuery('')
    setFlow((f) => f && { ...f, trail: [...f.trail, c] })
  }
  const pop = () => {
    if (!flow) return
    if (flow.trail.length === 0) {
      setFlow(null)
      setQuery(saved)
    } else {
      setQuery('')
      setFlow({ ...flow, trail: flow.trail.slice(0, -1) })
    }
  }
  const startFlow = (r: LookupResult) => {
    setSaved(query)
    setQuery('')
    open(r)
  }

  // After adding the menu closes and a Toast confirms, with a link to the Title.
  const added = (a: Added) => {
    toasts.success({
      text: (
        <span className="flex flex-col">
          <span className="font-medium">Added {a.title}</span>
          {a.summary && <span className="opacity-80">{a.summary}</span>}
        </span>
      ),
      action: { label: 'Open', onClick: () => onOpenTitle(a.id) },
    })
    onClose()
  }

  // ⌘↵ on a result adds it as Kestrel would by default, without opening its page.
  const quickAdd = async (r: LookupResult) => {
    try {
      const detail = await qc.fetchQuery(lookupDetailQuery(r.kind, r.tmdb_id))
      const versions = versionsOf(pickedFrom(detail), { kind: r.kind, profiles: profiles.data ?? [], slots })
      if (versions.length === 0) {
        toasts.error(`Couldn’t add ${r.title}. No Slot has a default Profile; open it to choose one.`)
        return
      }
      const title = await create.mutateAsync(createBody(r, versions, allEpisodes, null, null))
      added({
        id: title.id,
        title: r.title,
        summary: [versions.map((v) => slots.name(v.slot)).join(' and '), r.kind === 'series' ? monitorClause(allEpisodes, null) : ''].filter(Boolean).join(' · '),
      })
    } catch (e) {
      toasts.error(`Couldn’t add ${r.title}. ${e instanceof ApiError ? e.message : 'Try again.'}`)
    }
  }

  const results = lookup.data?.items
  const resultRow = (r: LookupResult) => {
    const inLibrary = r.in_library !== null
    return (
      <Row
        key={`${r.kind}-${r.tmdb_id}`}
        id={`tmdb-${r.kind}-${r.tmdb_id}`}
        poster={<Poster src={r.poster} size="row" />}
        title={r.title}
        year={r.year}
        sub={resultLine(r)}
        trail={inLibrary ? 'In Library' : !r.addable ? (r.not_addable_reason === 'tvdb_unavailable' ? 'TheTVDB Unreachable' : 'Not on TheTVDB') : undefined}
        disabled={!r.addable && !inLibrary}
        closes={inLibrary}
        run={() => (inLibrary ? onOpenTitle(r.in_library!) : startFlow(r))}
      />
    )
  }

  const q = query.trim()
  const rootRows = useMemo(() => {
    if (flow) return { groups: [] as { heading: string; rows: ReactNode[] }[], count: 0 }
    const addAction: Entry = {
      id: 'action-add',
      label: 'Add Title…',
      keywords: 'movie series new search add title tmdb',
      node: (
        <Row
          key="action-add"
          icon={<Plus />}
          title="Add Title…"
          sub="Search TMDB for a Movie or Series"
          run={() => {
            setQuery('')
            setMode('add')
          }}
        />
      ),
    }
    const act: Entry[] = [
      addAction,
      ...actions.map((a) => ({
        id: `action-${a.id}`,
        label: a.label,
        keywords: a.keywords,
        node: <Row key={`action-${a.id}`} icon={actionIcons[a.id] ?? <Command />} title={a.label} sub={actionNotes[a.id]} closes run={a.run} />,
      })),
    ]
    const go: Entry[] = places.map((p) => ({
      id: `go-${p.id}`,
      label: p.label,
      node: (
        <Row
          key={`go-${p.id}`}
          icon={p.icon ?? <Ban />}
          title={p.label}
          sub={p.id === 'library' && titles.data ? `${titles.data.length.toLocaleString('en')} Titles` : undefined}
          closes
          run={() => onGo(p.id)}
        />
      ),
    }))
    const titleRow = (t: TitleRow, recent = false) => (
      <Row
        key={`${recent ? 'recent' : 'title'}-${t.id}`}
        poster={<TitlePoster id={t.id} hasPoster={t.has_poster} size="row" />}
        title={t.title}
        year={t.year}
        sub={stateLine(t)}
        closes
        run={() => onOpenTitle(t.id)}
      />
    )
    if (q === '') {
      const recent = (titles.data ?? []).slice(0, 3)
      return {
        groups: [
          ...(recent.length > 0 ? [{ heading: 'Recent', rows: recent.map((t) => titleRow(t, true)) }] : []),
          { heading: 'Actions', rows: act.map((e) => e.node) },
          { heading: 'Go To', rows: go.map((e) => e.node) },
        ],
        count: recent.length + act.length + go.length,
      }
    }
    const scored = <T,>(hits: { item: T; match: { score: number } }[], toRow: (t: T) => ReactNode, heading: string) => ({
      score: hits[0]?.match.score ?? -1,
      heading,
      rows: hits.map((h) => toRow(h.item)),
    })
    const groups = [
      scored(rank(q, titles.data ?? [], (t) => [t.title, t.primary_title]).slice(0, 6), (t) => titleRow(t), 'Titles'),
      scored(
        rank(q, go, (i) => [i.label]),
        (i) => i.node,
        'Go To',
      ),
      scored(
        rank(q, act, (i) => [i.label, i.keywords ?? '']),
        (i) => i.node,
        'Actions',
      ),
    ]
      .filter((g) => g.rows.length > 0)
      .sort((a, b) => b.score - a.score) // the group holding the best match first; ties keep this order
    return { groups, count: groups.reduce((n, g) => n + g.rows.length, 0) }
  }, [flow, q, actions, places, titles.data, onGo, onOpenTitle])

  // TMDB's results follow the Library and the commands, as one more group.
  const meant = lookup.data?.did_you_mean
  const found: ReactNode[] =
    mode === 'add' || q !== ''
      ? [
          ...(meant
            ? [
                <Row
                  key="did-you-mean"
                  icon={<Search />}
                  title={`Did you mean ${meant}?`}
                  run={() => {
                    setQuery(meant)
                  }}
                />,
              ]
            : []),
          ...(results ?? []).map(resultRow),
        ]
      : []
  const groups = mode === 'add' ? [] : rootRows.groups
  const rowCount = (mode === 'add' ? 0 : rootRows.count) + found.length

  const onKeyDown = (e: CommandMenuKeyEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Enter' && mod && !e.nativeEvent.isComposing) {
      if (flow) {
        // On the page ⌘↵ adds; in a list it picks like Enter.
        if (flow.trail.length === 0) {
          e.preventDefault()
          addRef.current?.()
        }
        return
      }
      const active = inputRef.current?.getAttribute('aria-activedescendant')
      const id = (active && document.getElementById(active)?.querySelector('[data-row]')?.getAttribute('data-row')) || ''
      const r = results?.find((x) => `tmdb-${x.kind}-${x.tmdb_id}` === id)
      if (r) {
        e.preventDefault()
        if (r.in_library !== null) {
          onOpenTitle(r.in_library)
          onClose()
        } else if (r.addable) void quickAdd(r)
      }
      return
    }
    // Esc goes back one level; at the root it closes. skipMenu also keeps the browser from acting on the key.
    if (flow && e.key === 'Escape') {
      e.skipMenu()
      pop()
      return
    }
    // Going back from an empty field: out of a list or page, or out of Add mode. preventDefault also tells the menu to leave the key alone.
    if (e.key === 'Backspace' && query === '' && e.target === inputRef.current) {
      if (flow) {
        e.preventDefault()
        pop()
      } else if (mode === 'add') {
        e.preventDefault()
        setMode('root')
      }
    }
  }

  const crumbs = flow ? [flow.result.title, ...flow.trail.map(choiceLabel)] : []
  const loading = showLoading && searching && rowCount === 0 && !lookup.isError

  return (
    <DesignCommandMenu
      open
      onOpenChange={(o) => !o && onClose()}
      label="Command menu"
      className="kestrel-cmd"
      hotkey={false} // the Shell owns ⌘K
      query={query}
      onQueryChange={setQuery}
      shouldFilter={false} // rows are ranked and marked here
      onKeyDown={onKeyDown}
      inputRef={inputRef}
    >
      {/* Said again at every level, so a screen reader hears where it is: "Drug Lords › Monitor". */}
      <span role="status" className="sr-only">
        {crumbs.join(' › ')}
      </span>
      {flow ? (
        <AddFlow result={flow.result} trail={flow.trail} query={query} inputRef={inputRef} addRef={addRef} onPush={push} onPop={pop} onAdded={added} />
      ) : (
        <>
          <div className={phone ? 'kestrel-cmd-bar flex shrink-0 items-center pt-[env(safe-area-inset-top)] pr-2' : 'contents'}>
            <div className="min-w-0 flex-1">
              <CommandMenuInput
                prefix={mode === 'add' ? <span className="label-14 text-gray-1000">Add Title</span> : undefined}
                aria-label={mode === 'add' ? 'Search a Movie or Series to add' : 'Search, add or run a command'}
                placeholder={mode === 'add' ? 'Type a title to search both Movies and Series…' : phone ? 'Search or add a Title' : 'Search the Library, add a Title or run a command…'}
                hideClose={phone}
              />
            </div>
            {phone && (
              <Button variant="tertiary" onClick={onClose}>
                Cancel
              </Button>
            )}
          </div>
          <CommandMenuList
            loading={loading}
            empty={
              lookup.isError && rowCount === 0 ? (
                <Note variant="error" size="small">
                  {lookup.error instanceof ApiError ? lookup.error.message : 'The search failed.'}
                </Note>
              ) : undefined
            }
          >
            {groups.map((g) => (
              <CommandMenuGroup key={g.heading} heading={g.heading}>
                {g.rows}
              </CommandMenuGroup>
            ))}
            {found.length > 0 && <CommandMenuGroup heading="Add a Title">{found}</CommandMenuGroup>}
          </CommandMenuList>
          <Hints
            hints={[
              { label: 'Move', keys: [{ key: '↑' }, { key: '↓' }] },
              { label: 'Open', keys: [{ key: '↵' }] },
              ...(results && results.length > 0 ? [{ label: 'Add with Defaults', keys: [{ meta: true, key: '↵' }] }] : []),
            ]}
          />
        </>
      )}
    </DesignCommandMenu>
  )
}

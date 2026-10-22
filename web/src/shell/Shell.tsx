// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { About } from '../about/About'
import { Activity } from '../activity/Activity'
import { useRunningNow, type Running } from '../activity/running'
import { Badge, Button, Input, KeyboardInput, Note, Spinner, StatusDot, Tooltip } from '@hyprsh/design'
import { Activity as ActivityIcon, CalendarClock, Inbox, Info, LibraryBig, LogOut, Monitor, Moon, Plus, ScrollText, Search, Settings, Sun, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttention } from '../api/attention'
import { useAuth, useLogout, useSystem } from '../api/queries'
import { CommandMenu, type MenuAction, type MenuMode } from '../command/CommandMenu'
import { Adoption } from '../adoption/Adoption'
import { Cleanup } from '../cleanup/Cleanup'
import { CleanupLauncher } from '../cleanup/launch'
import { MOD } from '../keys'
import { useSearchAllWanted } from '../api/wanted'
import { Library } from '../library/Library'
import { startLiveStream } from '../live/stream'
import { Log } from '../log/Log'
import { Overview } from '../overview/Overview'
import { Requests } from '../requests/Requests'
import { currentPlace, PlaceOpener, placeOf, placePath, showPlace } from '../place'
import { Upcoming } from '../upcoming/Upcoming'
import { Settings as SettingsScreen } from '../screens/Settings'
import { useTheme, type Theme } from '../theme'
import { KestrelLogo } from '../ui'

const icon = 'size-4'
const screens = [
  { key: 'overview', label: 'Overview', icon: <Inbox className={icon} /> },
  { key: 'library', label: 'Library', icon: <LibraryBig className={icon} /> },
  { key: 'upcoming', label: 'Upcoming', icon: <CalendarClock className={icon} /> },
  { key: 'activity', label: 'Activity', icon: <ActivityIcon className={icon} /> },
  { key: 'log', label: 'Log', icon: <ScrollText className={icon} /> },
  { key: 'settings', label: 'Settings', icon: <Settings className={icon} /> },
]
const about = { key: 'about', label: 'About', icon: <Info className={icon} /> }
// Reached from Settings and the command menu, not the rail.
const adoption = { key: 'adoption', label: 'Adopt existing library' }
const cleanup = { key: 'cleanup', label: 'Clean up Unmanaged files' }
// Reached from the Overview's Recent requests, not the rail; a place, so "/requests?q=…" opens it.
const requests = { key: 'requests', label: 'Requests' }
const themeIcon: Record<Theme, ReactNode> = {
  system: <Monitor className={icon} />,
  light: <Sun className={icon} />,
  dark: <Moon className={icon} />,
}

const isPlace = (key: string) => [...screens, about, requests].some((s) => s.key === key)

export function Shell({ onRunSetup }: { onRunSetup: () => void }) {
  // A bookmarked address opens its screen with its filter.
  const [start] = useState(currentPlace)
  const [screen, setScreen] = useState(isPlace(start.screen) ? start.screen : 'overview')
  const [libraryId, setLibraryId] = useState<number | null>(null)
  const [cleanupTitles, setCleanupTitles] = useState<number[] | undefined>(undefined)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  // The text of a screen's filter field (the Library's or the Log's); another screen starts unfiltered.
  const [filter, setFilter] = useState({ screen: start.screen, q: start.q })
  const query = filter.screen === screen ? filter.q : ''
  useEffect(() => showPlace(placePath(screen, query)), [screen, query])
  const { theme, cycle } = useTheme()
  const auth = useAuth()
  const logout = useLogout()
  const current = [...screens, about, adoption, cleanup, requests].find((s) => s.key === screen)!
  const running = useRunningNow()

  // Every open tab stays live through one shared stream; the cache refetches on its hints.
  const queryClient = useQueryClient()
  useEffect(() => startLiveStream(queryClient), [queryClient])

  // ⌘K / Ctrl+K opens and closes the command menu from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMenu((m) => (m ? null : { mode: 'root' }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openCleanup = useCallback((titleIds?: number[]) => {
    setCleanupTitles(titleIds)
    setScreen('cleanup')
  }, [])
  const canLogout = auth.data?.state === 'ok' && auth.data.me.method === 'session'
  const searchAll = useSearchAllWanted()
  const { mutate: searchAllWanted } = searchAll
  // What "Search all Wanted" queued, until the person follows it to the Searching card or dismisses it.
  const [searchQueued, setSearchQueued] = useState<{ versions: number } | { error: string } | null>(null)
  const actions: MenuAction[] = useMemo(
    () => [
      {
        id: 'search-wanted',
        label: 'Search all Wanted',
        keywords: 'missing search catch up',
        run: () =>
          searchAllWanted(undefined, {
            onSuccess: (versions) => setSearchQueued({ versions }),
            onError: (e) => setSearchQueued({ error: e.message }),
          }),
      },
      { id: 'theme', label: 'Switch theme', keywords: 'dark light mode', run: cycle },
      { id: 'setup', label: 'Run setup again', keywords: 'wizard', run: onRunSetup },
      { id: 'adopt', label: 'Scan for unmanaged files', keywords: 'adopt adoption existing library import', run: () => setScreen('adoption') },
      { id: 'cleanup', label: 'Clean up Unmanaged files', keywords: 'junk samples subtitles delete tidy', run: () => openCleanup() },
      ...(canLogout ? [{ id: 'logout', label: 'Log out', keywords: 'sign out', run: () => logout.mutate(undefined) }] : []),
    ],
    [cycle, onRunSetup, canLogout, logout, searchAllWanted, openCleanup],
  )
  const places = useMemo(() => [...screens, about].map((s) => ({ id: s.key, label: s.label })), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  // An action that opens a place: "/settings/download-client" is the Settings screen at that
  // section, "/log?q=kind:failures" the Log with that filter.
  const goPath = useCallback((path: string) => {
    const { screen: key, section, q } = placeOf(path)
    if (!isPlace(key)) return
    setScreen(key)
    setFilter({ screen: key, q })
    if (section) setTimeout(() => document.getElementById(`${key}-${section}`)?.scrollIntoView?.(), 0)
  }, [])
  // An opened Title is shown, so the Library's filter must not hide it.
  const openTitle = useCallback((id: number) => {
    setLibraryId(id)
    setFilter({ screen: 'library', q: '' })
    setScreen('library')
  }, [])

  return (
    <CleanupLauncher.Provider value={openCleanup}>
    <PlaceOpener.Provider value={goPath}>
    {/* The 13px base the screens not yet built from the design inherit; they drop it with their own type classes. */}
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      <Rail screen={screen} onSelect={setScreen} theme={theme} onTheme={cycle} onAdd={() => setMenu({ mode: 'add' })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={current.label} onOpenMenu={() => setMenu({ mode: 'root' })} running={running} onOpenRunning={() => goPath('/activity/running')} />
        {searchQueued && (
          <SearchQueued
            queued={searchQueued}
            onSee={() => {
              setSearchQueued(null)
              goPath('/overview/searching')
            }}
            onDismiss={() => setSearchQueued(null)}
          />
        )}
        <main className="flex min-h-0 flex-1 flex-col">
          {screen === 'settings' ? (
            <SettingsScreen onRunSetup={onRunSetup} onAdopt={() => setScreen('adoption')} />
          ) : screen === 'adoption' ? (
            <Adoption />
          ) : screen === 'cleanup' ? (
            <Cleanup key={cleanupTitles?.join(',') ?? 'all'} titleIds={cleanupTitles} />
          ) : screen === 'library' ? (
            <Library
              query={query}
              onQuery={(q) => setFilter({ screen: 'library', q })}
              selectedId={libraryId}
              onSelect={setLibraryId}
              onAdd={() => setMenu({ mode: 'add' })}
              onAdopt={() => setScreen('adoption')}
            />
          ) : screen === 'about' ? (
            <About />
          ) : screen === 'log' ? (
            <Log query={query} onQuery={(q) => setFilter({ screen: 'log', q })} />
          ) : screen === 'activity' ? (
            <Activity
              query={query}
              onQuery={(q) => setFilter({ screen: 'activity', q })}
              onOpenTitle={openTitle}
              running={running}
              onOpenAdoption={() => setScreen('adoption')}
            />
          ) : screen === 'requests' ? (
            <Requests query={query} onQuery={(q) => setFilter({ screen: 'requests', q })} onOpenTitle={openTitle} />
          ) : screen === 'upcoming' ? (
            <Upcoming onOpenTitle={openTitle} />
          ) : (
            <Overview onOpen={goPath} onOpenTitle={openTitle} />
          )}
        </main>
      </div>
      {menu && <CommandMenu initialMode={menu.mode} actions={actions} places={places} onClose={closeMenu} onGo={setScreen} onOpenTitle={openTitle} />}
    </div>
    </PlaceOpener.Provider>
    </CleanupLauncher.Provider>
  )
}

function RailButton({
  label,
  active,
  onClick,
  badge,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip text={label} position="right">
      <Button svgOnly variant={active ? 'secondary' : 'tertiary'} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>
        {children}
        {badge}
      </Button>
    </Tooltip>
  )
}

/** How many rows need attention; red while any is Blocking. */
function AttentionBadge({ count, blocking }: { count: number; blocking: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none absolute -top-1 -right-1">
      <Badge variant={blocking ? 'red' : 'amber'} size="sm">
        {count}
      </Badge>
    </span>
  )
}

function Rail({
  screen,
  onSelect,
  theme,
  onTheme,
  onAdd,
}: {
  screen: string
  onSelect: (key: string) => void
  theme: Theme
  onTheme: () => void
  onAdd: () => void
}) {
  const logout = useLogout()
  const auth = useAuth()
  const attention = useAttention().data
  const needs = attention?.count ?? 0
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-gray-alpha-400 bg-background-200 py-3">
      <span className="mb-2 inline-flex">
        <Button svgOnly variant="tertiary" aria-label="Kestrel, go to Overview" onClick={() => onSelect('overview')}>
          <KestrelLogo />
        </Button>
      </span>
      <RailButton label={`Add Title (${MOD} K)`} onClick={onAdd}>
        <Plus className={icon} />
      </RailButton>
      <div className="my-1 h-px w-6 bg-gray-alpha-400" />
      {screens.map((s) => (
        <RailButton
          key={s.key}
          label={s.key === 'overview' && needs > 0 ? `${s.label}, ${needs} ${needs === 1 ? 'needs' : 'need'} attention` : s.label}
          active={screen === s.key}
          onClick={() => onSelect(s.key)}
          badge={s.key === 'overview' && needs > 0 ? <AttentionBadge count={needs} blocking={attention?.severity === 'blocking'} /> : undefined}
        >
          {s.icon}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton label={`Theme: ${theme}`} onClick={onTheme}>
        {themeIcon[theme]}
      </RailButton>
      <RailButton label={about.label} active={screen === about.key} onClick={() => onSelect(about.key)}>
        {about.icon}
      </RailButton>
      {/* A proxy-authenticated request has no session to end; the portal owns logging out. */}
      {auth.data?.state === 'ok' && auth.data.me.method === 'session' && (
        <RailButton label="Log out" onClick={() => logout.mutate(undefined)}>
          <LogOut className={icon} />
        </RailButton>
      )}
    </nav>
  )
}

/** Three columns with equal side tracks, so the command box stays centred whatever the right side holds. */
function TopBar({ title, onOpenMenu, running, onOpenRunning }: { title: string; onOpenMenu: () => void; running: Running[]; onOpenRunning: () => void }) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,460px)_minmax(0,1fr)] items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="heading-14 truncate">{title}</div>
      {/* A read-only field that opens the menu, so it reads as the search box it stands for. */}
      <Input
        readOnly
        size="small"
        aria-label="Search or run a command"
        aria-haspopup="dialog"
        placeholder="Search or run a command…"
        prefix={<Search aria-hidden className="size-4" />}
        prefixStyling={false}
        suffix={
          <span aria-hidden className="inline-flex">
            <KeyboardInput small meta />
            <KeyboardInput small>K</KeyboardInput>
          </span>
        }
        suffixStyling={false}
        style={{ cursor: 'pointer' }}
        onClick={onOpenMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault()
            onOpenMenu()
          }
        }}
      />
      <div className="flex min-w-0 items-center justify-end gap-4">
        <RunningIndicator running={running} onOpen={onOpenRunning} />
        <ServerStatus />
      </div>
    </header>
  )
}

/** The confirmation of "Search all Wanted", with the way to the Searching card that follows the searches. */
function SearchQueued({ queued, onSee, onDismiss }: { queued: { versions: number } | { error: string }; onSee: () => void; onDismiss: () => void }) {
  return (
    <div role="status" aria-label="Search all Wanted" className="flex shrink-0 items-center gap-2 border-b border-gray-alpha-400 bg-background-200 px-4 py-2">
      {'error' in queued ? (
        <Note variant="error" size="small" className="flex-1">{`Search all Wanted failed: ${queued.error}`}</Note>
      ) : (
        <Note
          size="small"
          className="flex-1"
          action={
            <Button size="small" onClick={onSee}>
              See the search
            </Button>
          }
        >
          {`${queued.versions} Wanted ${queued.versions === 1 ? 'Version' : 'Versions'} queued for a search`}
        </Note>
      )}
      <Button svgOnly variant="tertiary" size="small" aria-label="Dismiss" onClick={onDismiss}>
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  )
}

/** Quiet while nothing runs; a spinner and what runs, or how many things do, while work does. */
function RunningIndicator({ running, onOpen }: { running: Running[]; onOpen: () => void }) {
  if (running.length === 0) return null
  const [one] = running
  // The count takes the ellipsis's place: "Searching 15/40".
  const progress = one.progress?.total ? `${one.short.replace(/…$/, '')} ${one.progress.done}/${one.progress.total}` : null
  const label = running.length > 1 ? `${running.length} running` : (progress ?? one.short)
  return (
    <Button variant="tertiary" size="small" onClick={onOpen} title={running.map((r) => r.name).join('\n')} prefix={<Spinner size="sm" />}>
      {label}
    </Button>
  )
}

function ServerStatus() {
  const { data, isError } = useSystem()
  return (
    <span className="label-13 shrink-0 text-gray-900">
      <StatusDot titlePrefix="Kestrel" state={isError ? 'error' : data ? 'ready' : 'queued'} label={isError ? 'Offline' : data ? `Kestrel ${data.version}` : 'Connecting…'} />
    </span>
  )
}

// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { About } from '../about/About'
import { Activity } from '../activity/Activity'
import { useRunningNow, type Running } from '../activity/running'
import { Badge, Button, CommandMenuTrigger, Note, Spinner, ThemeSwitcher, Tooltip } from '@hyprsh/design'
import { Activity as ActivityIcon, CalendarClock, Eraser, FolderInput, Inbox, Info, LibraryBig, ListPlus, LogOut, Plus, ScrollText, Search, Settings, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttention } from '../api/attention'
import { useAuth, useLogout } from '../api/queries'
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
import { currentPlace, PlaceOpener, placeOf, placePath, pushedPlace, pushPlace, showPlace } from '../place'
import { usePhone } from '../responsive'
import { Upcoming } from '../upcoming/Upcoming'
import { Settings as SettingsScreen } from '../screens/Settings'
import { THEME_KEY, useTheme, type Theme } from '../theme'
import { KestrelLogo } from '../ui'
import { MoreSheet, PhoneTabBar, type Tab } from './PhoneNav'
import { ServerStatus } from './ServerStatus'

const screens = [
  { key: 'overview', label: 'Overview', icon: <Inbox /> },
  { key: 'library', label: 'Library', icon: <LibraryBig /> },
  { key: 'upcoming', label: 'Upcoming', icon: <CalendarClock /> },
  { key: 'activity', label: 'Activity', icon: <ActivityIcon /> },
  { key: 'log', label: 'Log', icon: <ScrollText /> },
  { key: 'settings', label: 'Settings', icon: <Settings /> },
]
const about = { key: 'about', label: 'About', icon: <Info /> }
// Reached from Settings and the command menu, not the rail.
const adoption = { key: 'adoption', label: 'Adopt existing library', icon: <FolderInput /> }
const cleanup = { key: 'cleanup', label: 'Clean up Unmanaged files', icon: <Eraser /> }
// Reached from the Overview's Recent requests, not the rail; a place, so "/requests?q=…" opens it.
const requests = { key: 'requests', label: 'Requests', icon: <ListPlus /> }
// The tab bar of a phone; the rest of the screens are behind More.
const tabKeys = ['overview', 'library', 'upcoming', 'activity']
// Settings and Log first, then the screens a phone reaches only from here (Requests also from the Overview), About last.
const moreKeys = ['settings', 'log', 'requests', 'adoption', 'cleanup', 'about']
// Short names for the More sheet; the top bar keeps the long ones.
const moreLabels: Record<string, string> = { adoption: 'Adoption', cleanup: 'Clean up' }
const isTitleId = (section: string) => /^\d+$/.test(section)
const isPlace = (key: string) => [...screens, about, requests].some((s) => s.key === key)

export function Shell({ onRunSetup }: { onRunSetup: () => void }) {
  // A bookmarked address opens its screen with its filter.
  const [start] = useState(currentPlace)
  const [screen, setScreen] = useState(isPlace(start.screen) ? start.screen : 'overview')
  // A phone shows the Library's list and an opened Title page as two screens; "/library/42" is the second.
  const phone = usePhone()
  const startTitle = start.screen === 'library' && isTitleId(start.section) ? Number(start.section) : null
  const [libraryId, setLibraryId] = useState<number | null>(startTitle)
  const [titleOpen, setTitleOpen] = useState(startTitle !== null)
  // On a phone Settings' list and an opened section are two screens; "/settings/indexers" is the second.
  const [settingsSection, setSettingsSection] = useState(start.screen === 'settings' ? start.section : '')
  const [more, setMore] = useState(false)
  const [cleanupTitles, setCleanupTitles] = useState<number[] | undefined>(undefined)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  // The text of a screen's filter field (the Library's or the Log's); another screen starts unfiltered.
  const [filter, setFilter] = useState({ screen: start.screen, q: start.q })
  const query = filter.screen === screen ? filter.q : ''
  const section = !phone ? '' : screen === 'library' ? (titleOpen && libraryId !== null ? String(libraryId) : '') : screen === 'settings' ? settingsSection : ''
  useEffect(() => showPlace(placePath(screen, query, section)), [screen, query, section])
  // Back and Forward step between the list and a Title page (and the screen a Title was opened from).
  useEffect(() => {
    const onPop = () => {
      const place = currentPlace()
      if (isPlace(place.screen)) setScreen(place.screen)
      setFilter({ screen: place.screen, q: place.q })
      setTitleOpen(isTitleId(place.section))
      setSettingsSection(place.screen === 'settings' ? place.section : '')
      if (isTitleId(place.section)) setLibraryId(Number(place.section))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const { theme, setTheme, cycle } = useTheme()
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
  const needs = useAttention().data
  const tabs: Tab[] = tabKeys
    .map((k) => screens.find((s) => s.key === k)!)
    .map((s) => ({
      ...s,
      ...(s.key === 'overview' && needs && needs.count > 0 ? { badge: needs.count, badgeLabel: `${needs.count} ${needs.count === 1 ? 'needs' : 'need'} attention` } : {}),
    }))
  const moreItems: Tab[] = moreKeys.map((k) => {
    const s = [...screens, about, adoption, cleanup, requests].find((x) => x.key === k)!
    return { ...s, label: moreLabels[k] ?? s.label }
  })
  const places = useMemo(() => [...screens, about].map((s) => ({ id: s.key, label: s.label })), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  // An action that opens a place: "/settings/download-client" is the Settings screen at that
  // section, "/log?q=kind:failures" the Log with that filter.
  const goPath = useCallback((path: string) => {
    const { screen: key, section, q } = placeOf(path)
    if (!isPlace(key)) return
    setScreen(key)
    setFilter({ screen: key, q })
    if (key === 'settings') {
      // A phone opens the section as its own screen; elsewhere it is scrolled to.
      setSettingsSection(section)
      if (phone && section) pushPlace(placePath('settings', '', section))
    }
    if (section && !(phone && key === 'settings')) setTimeout(() => document.getElementById(`${key}-${section}`)?.scrollIntoView?.(), 0)
  }, [phone])
  // An opened Title is shown, so the Library's filter must not hide it.
  const openTitle = useCallback(
    (id: number) => {
      setLibraryId(id)
      setFilter({ screen: 'library', q: '' })
      setScreen('library')
      setTitleOpen(true)
      if (phone) pushPlace(placePath('library', '', String(id)))
    },
    [phone],
  )
  // A tap on a Title in the Library's list on a phone.
  const openLibraryTitle = useCallback(
    (id: number) => {
      setLibraryId(id)
      setTitleOpen(true)
      pushPlace(placePath('library', query, String(id)))
    },
    [query],
  )
  const closeLibraryTitle = useCallback(() => {
    if (pushedPlace()) history.back()
    else setTitleOpen(false)
  }, [])
  const openSettingsSection = useCallback((id: string) => {
    setSettingsSection(id)
    pushPlace(placePath('settings', '', id))
  }, [])
  const closeSettingsSection = useCallback(() => {
    if (pushedPlace()) history.back()
    else setSettingsSection('')
  }, [])
  // The Library tab always leads to the list, also while a Title page is open; Settings to its list of sections.
  const select = useCallback((key: string) => {
    setScreen(key)
    if (key === 'library') setTitleOpen(false)
    if (key === 'settings') setSettingsSection('')
  }, [])

  return (
    <CleanupLauncher.Provider value={openCleanup}>
    <PlaceOpener.Provider value={goPath}>
    {/* The 13px base the screens not yet built from the design inherit; they drop it with their own type classes. */}
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      {!phone && <Rail screen={screen} onSelect={setScreen} theme={theme} onTheme={setTheme} onAdd={() => setMenu({ mode: 'add' })} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={current.label}
          phone={phone}
          onOpenMenu={() => setMenu({ mode: 'root' })}
          onAdd={() => setMenu({ mode: 'add' })}
          running={running}
          onOpenRunning={() => goPath('/activity/running')}
        />
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
        {/* The tab bar floats over the bottom of the screen and takes no space: its height is 0 when it is not shown. */}
        <main className="flex min-h-0 flex-1 flex-col pb-[var(--tab-bar-height)]">
          {screen === 'settings' ? (
            <SettingsScreen onRunSetup={onRunSetup} onAdopt={() => setScreen('adoption')} section={settingsSection} onOpenSection={openSettingsSection} onCloseSection={closeSettingsSection} />
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
              titleOpen={titleOpen}
              onOpenTitle={openLibraryTitle}
              onCloseTitle={closeLibraryTitle}
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
        {phone && (
          <PhoneTabBar
            tabs={tabs}
            screen={screen}
            moreActive={more || !tabKeys.includes(screen)}
            onSelect={select}
            onMore={() => setMore(true)}
          />
        )}
      </div>
      {phone && more && (
        <MoreSheet
          items={moreItems}
          screen={screen}
          onSelect={select}
          onClose={() => setMore(false)}
          theme={theme}
          onTheme={setTheme}
          onLogout={canLogout ? () => logout.mutate(undefined) : undefined}
        />
      )}
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
  onTheme: (theme: Theme) => void
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
        <Plus />
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
      {/* Applies the choice to <html> and saves it; the command menu's "Switch theme" moves it through the same value. */}
      <ThemeSwitcher variant="cycle" attribute="class" storageKey={THEME_KEY} value={theme} onChange={onTheme} tooltipPosition="right" />
      <RailButton label={about.label} active={screen === about.key} onClick={() => onSelect(about.key)}>
        {about.icon}
      </RailButton>
      {/* A proxy-authenticated request has no session to end; the portal owns logging out. */}
      {auth.data?.state === 'ok' && auth.data.me.method === 'session' && (
        <RailButton label="Log out" onClick={() => logout.mutate(undefined)}>
          <LogOut />
        </RailButton>
      )}
    </nav>
  )
}

/** Three columns with equal side tracks, so the command box stays centred whatever the right side holds. */
function TopBar({
  title,
  phone,
  onOpenMenu,
  onAdd,
  running,
  onOpenRunning,
}: {
  title: string
  phone: boolean
  onOpenMenu: () => void
  onAdd: () => void
  running: Running[]
  onOpenRunning: () => void
}) {
  // A phone has no room for the search box: the title, what runs, and buttons for Add and the menu.
  if (phone)
    return (
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-alpha-400 pr-2 pl-4">
        <div className="heading-14 min-w-0 flex-1 truncate">{title}</div>
        <RunningIndicator running={running} onOpen={onOpenRunning} />
        <Button svgOnly variant="tertiary" aria-label="Add Title" onClick={onAdd}>
          <Plus />
        </Button>
        <Button svgOnly variant="tertiary" aria-label="Search or run a command" onClick={onOpenMenu}>
          <Search />
        </Button>
      </header>
    )
  return (
    <header className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,460px)_minmax(0,1fr)] items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="heading-14 truncate">{title}</div>
      {/* A button that opens the menu, styled as the search box it stands for. */}
      <CommandMenuTrigger size="small" aria-label="Search or run a command" onClick={onOpenMenu} className="w-full">
        Search or run a command…
      </CommandMenuTrigger>
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
        <X aria-hidden />
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

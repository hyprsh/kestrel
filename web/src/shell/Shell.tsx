// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { About } from '../about/About'
import { CalendarClock, Inbox, Info, LibraryBig, LogOut, Monitor, Moon, Plus, ScrollText, Search, Settings, Sun } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttention } from '../api/attention'
import { useAuth, useLogout, useSystem } from '../api/queries'
import { CommandMenu, type MenuAction, type MenuMode } from '../command/CommandMenu'
import { Adoption } from '../adoption/Adoption'
import { Cleanup } from '../cleanup/Cleanup'
import { CleanupLauncher } from '../cleanup/launch'
import { Button } from '../forms'
import { MOD } from '../keys'
import { useSearchAllWanted } from '../api/wanted'
import { Library, type Preset } from '../library/Library'
import { startLiveStream } from '../live/stream'
import { Log } from '../log/Log'
import { Overview } from '../overview/Overview'
import { Upcoming } from '../upcoming/Upcoming'
import { Settings as SettingsScreen } from '../screens/Settings'
import { useTheme, type Theme } from '../theme'
import { cx, Kbd, KestrelLogo } from '../ui'

const icon = 'size-[18px]'
const screens = [
  { key: 'overview', label: 'Overview', icon: <Inbox className={icon} /> },
  { key: 'library', label: 'Library', icon: <LibraryBig className={icon} /> },
  { key: 'upcoming', label: 'Upcoming', icon: <CalendarClock className={icon} /> },
  { key: 'log', label: 'Log', icon: <ScrollText className={icon} /> },
  { key: 'settings', label: 'Settings', icon: <Settings className={icon} /> },
]
const about = { key: 'about', label: 'About', icon: <Info className={icon} /> }
// Reached from Settings and the command menu, not the rail.
const adoption = { key: 'adoption', label: 'Adopt existing library' }
const cleanup = { key: 'cleanup', label: 'Clean up Unmanaged files' }
const themeIcon: Record<Theme, ReactNode> = {
  system: <Monitor className={icon} />,
  light: <Sun className={icon} />,
  dark: <Moon className={icon} />,
}

export function Shell({ onRunSetup }: { onRunSetup: () => void }) {
  const [screen, setScreen] = useState('overview')
  const [libraryId, setLibraryId] = useState<number | null>(null)
  const [cleanupTitles, setCleanupTitles] = useState<number[] | undefined>(undefined)
  const [libraryPreset, setLibraryPreset] = useState<{ preset: Preset; n: number } | null>(null)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  const { theme, cycle } = useTheme()
  const auth = useAuth()
  const logout = useLogout()
  const current = [...screens, about, adoption, cleanup].find((s) => s.key === screen)!

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
  // An action that opens a place: "/settings/download-client" is the Settings screen at that section.
  const goPath = useCallback((path: string) => {
    const [key, section] = path.replace(/^\//, '').split('/')
    if (![...screens, about].some((s) => s.key === key)) return
    setScreen(key)
    // "/library/long-missing" opens the Library on the Wanted filter with the Long Missing chip.
    if (key === 'library') setLibraryPreset(section === 'long-missing' ? { preset: 'long_missing', n: Date.now() } : null)
    else if (section) setTimeout(() => document.getElementById(`${key}-${section}`)?.scrollIntoView?.(), 0)
  }, [])
  // Going to a screen from the rail or the menu clears a preset left by an earlier link.
  const select = useCallback((key: string) => {
    setScreen(key)
    if (key === 'library') setLibraryPreset(null)
  }, [])
  const openTitle = useCallback((id: number) => {
    setLibraryId(id)
    setLibraryPreset(null)
    setScreen('library')
  }, [])

  return (
    <CleanupLauncher.Provider value={openCleanup}>
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      <Rail screen={screen} onSelect={select} theme={theme} onTheme={cycle} onAdd={() => setMenu({ mode: 'add' })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={current.label} onOpenMenu={() => setMenu({ mode: 'root' })} />
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
              key={libraryPreset?.n ?? 0}
              preset={libraryPreset?.preset}
              selectedId={libraryId}
              onSelect={setLibraryId}
              onAdd={() => setMenu({ mode: 'add' })}
              onAdopt={() => setScreen('adoption')}
            />
          ) : screen === 'about' ? (
            <About />
          ) : screen === 'log' ? (
            <Log />
          ) : screen === 'upcoming' ? (
            <Upcoming onOpenTitle={openTitle} />
          ) : (
            <Overview onOpen={goPath} onOpenTitle={openTitle} />
          )}
        </main>
      </div>
      {menu && <CommandMenu initialMode={menu.mode} actions={actions} places={places} onClose={closeMenu} onGo={select} onOpenTitle={openTitle} />}
    </div>
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
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex size-9 items-center justify-center rounded-md transition-colors',
        active ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000',
      )}
    >
      {children}
      {badge}
      <span
        aria-hidden
        className="pointer-events-none absolute left-full z-50 ml-2 hidden rounded-md bg-gray-1000 px-2 py-1 text-[12px] font-medium whitespace-nowrap text-background-100 shadow-lg group-hover:block"
      >
        {label}
      </span>
    </button>
  )
}

/** How many rows need attention; red while any is Blocking. */
function AttentionBadge({ count, blocking }: { count: number; blocking: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white',
        blocking ? 'bg-red-700' : 'bg-amber-700',
      )}
    >
      {count}
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
      <button
        onClick={() => onSelect('overview')}
        aria-label="Kestrel, go to Overview"
        className="mb-2 flex size-9 items-center justify-center rounded-md text-gray-1000 transition-colors hover:bg-gray-alpha-100"
      >
        <KestrelLogo />
      </button>
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

function TopBar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="w-40 text-[13px] font-medium">{title}</div>
      <button
        onClick={onOpenMenu}
        className="mx-auto flex h-8 w-full max-w-[460px] items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-200 px-2.5 text-gray-900 transition-colors hover:border-gray-500 hover:text-gray-1000"
      >
        <Search className="size-3.5" />
        <span className="text-[13px]">Search or run a command…</span>
        <span className="ml-auto flex gap-0.5">
          <Kbd>{MOD}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <ServerStatus />
    </header>
  )
}

/** The confirmation of "Search all Wanted", with the way to the Searching card that follows the searches. */
function SearchQueued({ queued, onSee, onDismiss }: { queued: { versions: number } | { error: string }; onSee: () => void; onDismiss: () => void }) {
  return (
    <div role="status" aria-label="Search all Wanted" className="flex shrink-0 items-center gap-3 border-b border-gray-alpha-400 bg-background-200 px-4 py-2 text-[12px]">
      {'error' in queued ? (
        <span className="text-red-900">{`Search all Wanted failed: ${queued.error}`}</span>
      ) : (
        <>
          <span>{`${queued.versions} Wanted ${queued.versions === 1 ? 'Version' : 'Versions'} queued for a search`}</span>
          <Button variant="secondary" onClick={onSee}>
            See the search
          </Button>
        </>
      )}
      <Button variant="secondary" className="ml-auto" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

function ServerStatus() {
  const { data, isError } = useSystem()
  return (
    <div className="flex w-40 items-center justify-end gap-2 text-[12px] text-gray-900">
      <span className={cx('size-1.5 rounded-full', isError ? 'bg-red-700' : data ? 'bg-green-700' : 'bg-gray-600')} />
      {isError ? 'Offline' : data ? `Kestrel ${data.version}` : 'Connecting…'}
    </div>
  )
}

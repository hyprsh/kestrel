// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { CalendarClock, Inbox, Info, LibraryBig, LogOut, Monitor, Moon, Plus, ScrollText, Search, Settings, Sun } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth, useLogout, useSystem } from '../api/queries'
import { CommandMenu, type MenuAction, type MenuMode } from '../command/CommandMenu'
import { MOD } from '../keys'
import { Library } from '../library/Library'
import { Overview } from '../overview/Overview'
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
const themeIcon: Record<Theme, ReactNode> = {
  system: <Monitor className={icon} />,
  light: <Sun className={icon} />,
  dark: <Moon className={icon} />,
}

export function Shell({ onRunSetup }: { onRunSetup: () => void }) {
  const [screen, setScreen] = useState('overview')
  const [libraryId, setLibraryId] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  const { theme, cycle } = useTheme()
  const auth = useAuth()
  const logout = useLogout()
  const current = [...screens, about].find((s) => s.key === screen)!

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

  const canLogout = auth.data?.state === 'ok' && auth.data.me.method === 'session'
  const actions: MenuAction[] = useMemo(
    () => [
      { id: 'theme', label: 'Switch theme', keywords: 'dark light mode', run: cycle },
      { id: 'setup', label: 'Run setup again', keywords: 'wizard', run: onRunSetup },
      ...(canLogout ? [{ id: 'logout', label: 'Log out', keywords: 'sign out', run: () => logout.mutate(undefined) }] : []),
    ],
    [cycle, onRunSetup, canLogout, logout],
  )
  const places = useMemo(() => [...screens, about].map((s) => ({ id: s.key, label: s.label })), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const openTitle = useCallback((id: number) => {
    setLibraryId(id)
    setScreen('library')
  }, [])

  return (
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      <Rail screen={screen} onSelect={setScreen} theme={theme} onTheme={cycle} onAdd={() => setMenu({ mode: 'add' })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={current.label} onOpenMenu={() => setMenu({ mode: 'root' })} />
        <main className="flex min-h-0 flex-1 flex-col">
          {screen === 'settings' ? (
            <SettingsScreen onRunSetup={onRunSetup} />
          ) : screen === 'library' ? (
            <Library selectedId={libraryId} onSelect={setLibraryId} onAdd={() => setMenu({ mode: 'add' })} />
          ) : screen === 'overview' ? (
            <Overview />
          ) : (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <div className="text-sm font-medium">Nothing here yet</div>
                <div className="mt-1 text-gray-900">{current.label} arrives in a later release.</div>
              </div>
            </div>
          )}
        </main>
      </div>
      {menu && <CommandMenu initialMode={menu.mode} actions={actions} places={places} onClose={closeMenu} onGo={setScreen} onOpenTitle={openTitle} />}
    </div>
  )
}

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
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
      <span
        aria-hidden
        className="pointer-events-none absolute left-full z-50 ml-2 hidden rounded-md bg-gray-1000 px-2 py-1 text-[12px] font-medium whitespace-nowrap text-background-100 shadow-lg group-hover:block"
      >
        {label}
      </span>
    </button>
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
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-gray-alpha-400 bg-background-200 py-3">
      <div className="mb-2 flex size-9 items-center justify-center text-gray-1000">
        <KestrelLogo />
      </div>
      <RailButton label={`Add Title (${MOD} K)`} onClick={onAdd}>
        <Plus className={icon} />
      </RailButton>
      <div className="my-1 h-px w-6 bg-gray-alpha-400" />
      {screens.map((s) => (
        <RailButton key={s.key} label={s.label} active={screen === s.key} onClick={() => onSelect(s.key)}>
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

function ServerStatus() {
  const { data, isError } = useSystem()
  return (
    <div className="flex w-40 items-center justify-end gap-2 text-[12px] text-gray-900">
      <span className={cx('size-1.5 rounded-full', isError ? 'bg-red-700' : data ? 'bg-green-700' : 'bg-gray-600')} />
      {isError ? 'Offline' : data ? `Kestrel ${data.version}` : 'Connecting…'}
    </div>
  )
}

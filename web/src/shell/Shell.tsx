// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { CalendarClock, Inbox, Info, LibraryBig, LogOut, Monitor, Moon, Plus, ScrollText, Search, Settings, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAuth, useLogout, useSystem } from '../api/queries'
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
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

export function Shell() {
  const [screen, setScreen] = useState('overview')
  const current = [...screens, about].find((s) => s.key === screen)!

  return (
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      <Rail screen={screen} onSelect={setScreen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={current.label} />
        <main className="flex min-h-0 flex-1 flex-col">
          {screen === 'settings' ? (
            <SettingsScreen />
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

function Rail({ screen, onSelect }: { screen: string; onSelect: (key: string) => void }) {
  const { theme, cycle } = useTheme()
  const logout = useLogout()
  const auth = useAuth()
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-gray-alpha-400 bg-background-200 py-3">
      <div className="mb-2 flex size-9 items-center justify-center text-gray-1000">
        <KestrelLogo />
      </div>
      <RailButton label={`Add Title (${mod} K)`} onClick={() => {}}>
        <Plus className={icon} />
      </RailButton>
      <div className="my-1 h-px w-6 bg-gray-alpha-400" />
      {screens.map((s) => (
        <RailButton key={s.key} label={s.label} active={screen === s.key} onClick={() => onSelect(s.key)}>
          {s.icon}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton label={`Theme: ${theme}`} onClick={cycle}>
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

function TopBar({ title }: { title: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="w-40 text-[13px] font-medium">{title}</div>
      <button className="mx-auto flex h-8 w-full max-w-[460px] items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-200 px-2.5 text-gray-900 transition-colors hover:border-gray-500 hover:text-gray-1000">
        <Search className="size-3.5" />
        <span className="text-[13px]">Search or run a command…</span>
        <span className="ml-auto flex gap-0.5">
          <Kbd>{mod}</Kbd>
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

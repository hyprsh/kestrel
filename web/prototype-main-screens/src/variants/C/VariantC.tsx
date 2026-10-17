// PROTOTYPE, throwaway. Variant C · Command.
// Keyboard-first, status-first: a thin icon rail plus a ⌘K command menu as the main navigation and action surface.
// Home is "does anything need me?" (Overview); the library is a split pane (list left, Title detail right).
import { useEffect, type ReactNode } from 'react'
import { CalendarClock, Inbox, Info, LibraryBig, Plus, ScrollText, Search, Settings as SettingsIcon } from 'lucide-react'
import { go, useParam } from '../../nav'
import { cx, Kbd, KestrelLogo } from '../../ui'
import { StoreProvider, useStore } from './store'
import { MOD } from './bits'
import { CommandMenu } from './CommandMenu'
import { Overview, useAttention } from './Overview'
import { Library } from './Library'
import { Upcoming } from './Upcoming'
import { Log } from './Log'
import { Settings } from './Settings'
import { Wizard } from './Wizard'
import { About } from './About'

export function VariantC() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

const screens: { key: string; label: string; icon: ReactNode; match: string[] }[] = [
  { key: 'overview', label: 'Overview', icon: <Inbox className="size-[18px]" />, match: ['overview', 'add'] },
  { key: 'library', label: 'Library', icon: <LibraryBig className="size-[18px]" />, match: ['library', 'title', 'search'] },
  { key: 'upcoming', label: 'Upcoming', icon: <CalendarClock className="size-[18px]" />, match: ['upcoming'] },
  { key: 'activity', label: 'Log', icon: <ScrollText className="size-[18px]" />, match: ['activity'] },
  { key: 'settings', label: 'Settings', icon: <SettingsIcon className="size-[18px]" />, match: ['settings'] },
]

function Shell() {
  const screen = useParam('screen', 'overview')
  const s = useStore()

  // ⌘K / Ctrl+K toggles the command menu everywhere (except the wizard, which has no app shell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.menu.open ? s.closeMenu() : s.openMenu()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // screen=add is the command menu in "Add Title" mode, over the Overview.
  useEffect(() => {
    if (screen === 'add') s.openMenu('add')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  if (screen === 'wizard')
    return (
      <div className="h-full text-[13px]">
        <Wizard />
        <Toasts />
      </div>
    )

  const body = (() => {
    switch (screen) {
      case 'library':
      case 'title':
      case 'search':
        return <Library />
      case 'upcoming':
        return <Upcoming />
      case 'activity':
        return <Log />
      case 'settings':
        return <Settings />
      case 'about':
        return <About />
      default:
        return <Overview />
    }
  })()

  return (
    <div className="flex h-full bg-background-100 text-[13px] text-gray-1000">
      <Rail screen={screen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar screen={screen} />
        <main className="min-h-0 flex-1">{body}</main>
      </div>
      <CommandMenu />
      <Toasts />
    </div>
  )
}

function RailButton({ label, active, onClick, children, badge }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cx('group relative flex size-9 items-center justify-center rounded-md transition-colors', active ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000')}
    >
      {children}
      {!!badge && <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-red-700 font-mono text-[9px] font-semibold text-white">{badge}</span>}
      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden rounded-md bg-gray-1000 px-2 py-1 text-[12px] font-medium whitespace-nowrap text-background-100 shadow-lg group-hover:block">{label}</span>
    </button>
  )
}

function Rail({ screen }: { screen: string }) {
  const s = useStore()
  const attention = useAttention().count
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-gray-alpha-400 bg-background-200 py-3">
      <button onClick={() => go('overview')} className="mb-2 flex size-9 items-center justify-center text-gray-1000" aria-label="Kestrel">
        <KestrelLogo />
      </button>
      <RailButton label={`Add Title  (${MOD} K)`} onClick={() => s.openMenu('add')}>
        <Plus className="size-[18px]" />
      </RailButton>
      <div className="my-1 h-px w-6 bg-gray-alpha-400" />
      {screens.map((x) => (
        <RailButton key={x.key} label={x.label} active={x.match.includes(screen)} onClick={() => go(x.key)} badge={x.key === 'overview' ? attention : undefined}>
          {x.icon}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton label="About" active={screen === 'about'} onClick={() => go('about')}>
        <Info className="size-[18px]" />
      </RailButton>
    </nav>
  )
}

const screenName: Record<string, string> = { overview: 'Overview', add: 'Overview', library: 'Library', title: 'Library', search: 'Manual search', upcoming: 'Upcoming', activity: 'Log', settings: 'Settings', about: 'About' }

function TopBar({ screen }: { screen: string }) {
  const s = useStore()
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-alpha-400 px-4">
      <div className="w-40 text-[13px] font-medium text-gray-1000">{screenName[screen] ?? 'Overview'}</div>
      <button
        onClick={() => s.openMenu()}
        className="mx-auto flex h-8 w-full max-w-[460px] items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-200 px-2.5 text-gray-900 transition-colors hover:border-gray-500 hover:text-gray-1000"
      >
        <Search className="size-3.5" />
        <span className="text-[13px]">Search or run a command…</span>
        <span className="ml-auto flex gap-0.5">
          <Kbd>{MOD}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="flex w-40 items-center justify-end gap-2 text-[12px] text-gray-900">
        <span className="size-1.5 rounded-full bg-green-700" />
        SABnzbd connected
      </div>
    </header>
  )
}

function Toasts() {
  const { toasts } = useStore()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto max-w-sm rounded-lg border border-gray-alpha-400 bg-background-100 px-3.5 py-2.5 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          {t.text}
        </div>
      ))}
    </div>
  )
}

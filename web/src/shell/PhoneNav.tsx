// The shell on a phone: a bottom tab bar in place of the icon rail, and the More sheet that holds
// the rest of the rail (Settings, Log, About, the theme, signing out) and the version with its status dot.
import { Button, Drawer, ThemeSwitcher } from '@hyprsh/design'
import { Ellipsis, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { THEME_KEY, type Theme } from '../theme'
import { cx } from '../ui'
import { ServerStatus } from './ServerStatus'

export type Tab = { key: string; label: string; icon: ReactNode; badge?: ReactNode }

function TabButton({ label, icon, badge, active, onClick, haspopup }: { label: string; icon: ReactNode; badge?: ReactNode; active: boolean; onClick: () => void; haspopup?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-haspopup={haspopup ? 'dialog' : undefined}
      onClick={onClick}
      className={cx('relative flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium', active ? 'text-gray-1000' : 'text-gray-900')}
    >
      <span className="relative inline-flex [&_svg]:size-5">
        {icon}
        {badge}
      </span>
      <span className="max-w-full truncate" aria-hidden>
        {label}
      </span>
    </button>
  )
}

/** Overview, Library, Upcoming, Activity and More; `moreActive` while the screen shown lives in More. */
export function TabBar({ tabs, screen, moreActive, onSelect, onMore }: { tabs: Tab[]; screen: string; moreActive: boolean; onSelect: (key: string) => void; onMore: () => void }) {
  return (
    <nav aria-label="Screens" className="flex shrink-0 border-t border-gray-alpha-400 bg-background-200 pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <TabButton key={t.key} label={t.label} icon={t.icon} badge={t.badge} active={screen === t.key} onClick={() => onSelect(t.key)} />
      ))}
      <TabButton label="More" icon={<Ellipsis />} active={moreActive} onClick={onMore} haspopup />
    </nav>
  )
}

/** A bottom sheet with the screens the tab bar has no room for, the theme switch, Log out and the version. */
export function MoreSheet({
  items,
  screen,
  onSelect,
  onClose,
  theme,
  onTheme,
  onLogout,
}: {
  items: Tab[]
  screen: string
  onSelect: (key: string) => void
  onClose: () => void
  theme: Theme
  onTheme: (theme: Theme) => void
  /** Absent when the request needs no session to end (the proxy owns logging out). */
  onLogout?: () => void
}) {
  return (
    <Drawer show onDismiss={onClose} aria-label="More">
      <div className="flex flex-col gap-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {items.map((t) => (
          <Button
            key={t.key}
            variant={screen === t.key ? 'secondary' : 'tertiary'}
            aria-current={screen === t.key ? 'page' : undefined}
            prefix={t.icon}
            width="100%"
            className="justify-start"
            onClick={() => {
              onSelect(t.key)
              onClose()
            }}
          >
            {t.label}
          </Button>
        ))}
        <div className="my-1 h-px bg-gray-alpha-400" />
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="label-14">Theme</span>
          <ThemeSwitcher variant="radios" attribute="class" storageKey={THEME_KEY} value={theme} onChange={onTheme} />
        </div>
        {onLogout && (
          <Button variant="tertiary" prefix={<LogOut />} width="100%" className="justify-start" onClick={onLogout}>
            Log out
          </Button>
        )}
        <div className="flex px-2 pt-2">
          <ServerStatus />
        </div>
      </div>
    </Drawer>
  )
}

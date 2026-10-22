// The shell on a phone: a bottom tab bar in place of the icon rail, and the More sheet that holds
// the rest of the rail (Settings, Log, About, the theme, signing out) and the version with its status dot.
import { Button, Drawer, TabBar, ThemeSwitcher } from '@hyprsh/design'
import { Ellipsis, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { THEME_KEY, type Theme } from '../theme'
import { ServerStatus } from './ServerStatus'

export type Tab = { key: string; label: string; icon: ReactNode; /** A count for the tab bar. */ badge?: number; badgeLabel?: string }

/** Overview, Library, Upcoming, Activity and More; More is `current` while the screen shown lives in More or its sheet is open. */
export function PhoneTabBar({ tabs, screen, moreActive, onSelect, onMore }: { tabs: Tab[]; screen: string; moreActive: boolean; onSelect: (key: string) => void; onMore: () => void }) {
  return (
    <TabBar label="Screens" value={screen} onChange={onSelect}>
      {tabs.map((t) => (
        <TabBar.Item key={t.key} value={t.key} label={t.label} icon={t.icon} badge={t.badge} badgeLabel={t.badgeLabel} />
      ))}
      <TabBar.Item label="More" icon={<Ellipsis />} haspopup current={moreActive} onClick={onMore} />
    </TabBar>
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

// The shell on a phone: a bottom tab bar in place of the icon rail, and the More sheet that holds
// the rest of the rail (Settings, Log, About, the theme, signing out) and the version with its status dot.
import { Drawer, Entity, Separator, TabBar, ThemeSwitcher } from '@hyprsh/design'
import { Ellipsis, LogOut, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { THEME_KEY, type Theme } from '../theme'
import { ServerStatus } from './ServerStatus'

export type Tab = { key: string; label: string; icon: ReactNode; badge?: number; badgeTone?: 'error' | 'warning'; badgeLabel?: string }

/** Overview, Library, Upcoming, Activity and More, with Search as the accessory; `moreActive` while the screen shown lives in More. */
export function PhoneTabBar({
  tabs,
  screen,
  moreActive,
  onSelect,
  onMore,
  onSearch,
}: {
  tabs: Tab[]
  screen: string
  moreActive: boolean
  onSelect: (key: string) => void
  onMore: () => void
  onSearch: () => void
}) {
  return (
    <TabBar label="Screens" value={moreActive ? undefined : screen} onChange={onSelect} minimizeOnScroll accessory={{ label: 'Search or run a command', icon: <Search />, onClick: onSearch }}>
      {tabs.map((t) => (
        <TabBar.Item key={t.key} value={t.key} label={t.label} icon={t.icon} badge={t.badge} badgeTone={t.badgeTone} badgeLabel={t.badgeLabel} />
      ))}
      <TabBar.Item label="More" icon={<Ellipsis />} current={moreActive} haspopup onClick={onMore} />
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
          <Entity
            key={t.key}
            as="button"
            left={t.icon}
            aria-current={screen === t.key ? 'page' : undefined}
            onClick={() => {
              onSelect(t.key)
              onClose()
            }}
          >
            <Entity.Content title={t.label} fill />
          </Entity>
        ))}
        <Separator />
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="label-14">Theme</span>
          <ThemeSwitcher variant="radios" attribute="class" storageKey={THEME_KEY} value={theme} onChange={onTheme} />
        </div>
        {onLogout && (
          <Entity as="button" left={<LogOut />} onClick={onLogout}>
            <Entity.Content title="Log out" fill />
          </Entity>
        )}
        <div className="flex px-2 pt-2">
          <ServerStatus />
        </div>
      </div>
    </Drawer>
  )
}

// The Geist shell: a thin icon rail plus a top bar with the command-menu entry.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { About } from '../about/About'
import { Activity } from '../activity/Activity'
import { useRunningNow, type Running } from '../activity/running'
import { activityTabOf, activityTabSection, type ActivityTab } from '../activity/tabs'
import { Button, CommandMenuTrigger, Separator, StatusDot, ThemeSwitcher, Tooltip, useToasts } from '@hyprsh/design'
import { Activity as ActivityIcon, CalendarClock, Eraser, FolderInput, Inbox, Info, LibraryBig, ListPlus, LogOut, Plus, ScrollText, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttention } from '../api/attention'
import { useAuth, useLogout } from '../api/queries'
import { CommandMenu, type MenuAction, type MenuMode } from '../command/CommandMenu'
import { Adoption } from '../adoption/Adoption'
import { adoptionLabel, useAdoption } from '../api/adoption'
import { Cleanup } from '../cleanup/Cleanup'
import { CleanupLauncher } from '../cleanup/launch'
import { MOD } from '../keys'
import { useSearchAllWanted } from '../api/wanted'
import { Library } from '../library/Library'
import { startLiveStream } from '../live/stream'
import { Log } from '../log/Log'
import { Overview } from '../overview/Overview'
import { Requests } from '../requests/Requests'
import { useTrashOutcomeToasts } from '../trash/toasts'
import { EpisodeViewContext, noEpisodeView, type EpisodeView } from '../library/episodeView'
import { currentPlace, PlaceOpener, placeOf, placePath, pushedPlace, pushPlace, showPlace } from '../place'
import { usePhone } from '../responsive'
import { Upcoming } from '../upcoming/Upcoming'
import { Settings as SettingsScreen } from '../screens/Settings'
import { THEME_KEY, useTheme, type Theme } from '../theme'
import { KestrelLogo } from '../ui'
import { Rail as RailFrame, RailSpacer } from '../layout/Rail'
import { PhoneTopBar, TopBar as TopBarFrame } from '../layout/TopBar'
import { BlockingBanner } from './BlockingBanner'
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
  // A Series' season tab and found episode ("/library?season=2&episode=5"), kept here so they reach the address bar.
  const [episodeView, setEpisodeView] = useState<EpisodeView>(() =>
    start.screen === 'library' && start.season !== null ? { titleId: startTitle, season: start.season, episode: start.episode } : noEpisodeView,
  )
  // On a phone Settings' list and an opened section are two screens; "/settings/indexers" is the second.
  const [settingsSection, setSettingsSection] = useState(start.screen === 'settings' ? start.section : '')
  const [more, setMore] = useState(false)
  const [cleanupTitles, setCleanupTitles] = useState<number[] | undefined>(undefined)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  // The text of a screen's filter field (the Library's or the Log's); another screen starts unfiltered.
  const [filter, setFilter] = useState({ screen: start.screen, q: start.q })
  const query = filter.screen === screen ? filter.q : ''
  const section = !phone ? '' : screen === 'library' ? (titleOpen && libraryId !== null ? String(libraryId) : '') : screen === 'settings' ? settingsSection : ''
  // Activity's tab is the place's section ("/activity/health"); only Grabs has a filter.
  const [activityTab, setActivityTab] = useState<ActivityTab>(start.screen === 'activity' ? activityTabOf(start.section) : 'grabs')
  // Another Title selected: its Series' season and found episode are not the previous Title's (a Movie shows none). A view that names no Title stays for the first Series shown.
  useEffect(() => {
    if (libraryId !== null) setEpisodeView((v) => (v.titleId !== null && v.titleId !== libraryId ? noEpisodeView : v))
  }, [libraryId])
  const shownView = screen === 'library' ? episodeView : noEpisodeView
  const address = screen === 'activity' ? { q: activityTab === 'grabs' ? query : '', section: activityTabSection(activityTab) } : { q: query, section }
  useEffect(() => showPlace(placePath(screen, address.q, address.section, shownView)), [screen, address.q, address.section, shownView])
  // A click on a tab is a history entry of its own, so Back returns to the tab before it.
  const openActivityTab = useCallback(
    (tab: ActivityTab) => {
      setActivityTab(tab)
      pushPlace(placePath('activity', tab === 'grabs' ? filter.q : '', activityTabSection(tab)))
    },
    [filter.q],
  )
  // Back and Forward step between the list and a Title page (and the screen a Title was opened from).
  useEffect(() => {
    const onPop = () => {
      const place = currentPlace()
      if (isPlace(place.screen)) setScreen(place.screen)
      if (place.screen === 'activity') setActivityTab(activityTabOf(place.section))
      setFilter({ screen: place.screen, q: place.q })
      setTitleOpen(isTitleId(place.section))
      setEpisodeView(place.season === null ? noEpisodeView : { titleId: isTitleId(place.section) ? Number(place.section) : null, season: place.season, episode: place.episode })
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
  useTrashOutcomeToasts()
  const toasts = useToasts()
  const adoptionState = useAdoption().data?.state
  const actions: MenuAction[] = useMemo(
    () => [
      {
        id: 'search-wanted',
        label: 'Search all Wanted',
        keywords: 'missing search catch up',
        run: () =>
          searchAllWanted(undefined, {
            onSuccess: (versions) => toasts.success(`${versions} Wanted ${versions === 1 ? 'Version' : 'Versions'} queued for a search`),
            onError: (e) => toasts.error(`Search all Wanted failed: ${e.message}`),
          }),
      },
      { id: 'theme', label: 'Switch theme', keywords: 'dark light mode', run: cycle },
      { id: 'setup', label: 'Run setup again', keywords: 'wizard', run: onRunSetup },
      { id: 'adopt', label: adoptionLabel(adoptionState), keywords: 'adopt adoption existing library import', run: () => setScreen('adoption') },
      { id: 'cleanup', label: 'Clean up Unmanaged files', keywords: 'junk samples subtitles delete tidy', run: () => openCleanup() },
      ...(canLogout ? [{ id: 'logout', label: 'Log out', keywords: 'sign out', run: () => logout.mutate(undefined) }] : []),
    ],
    [cycle, onRunSetup, canLogout, logout, searchAllWanted, toasts, openCleanup, adoptionState],
  )
  const needs = useAttention().data
  const tabs: Tab[] = tabKeys
    .map((k) => screens.find((s) => s.key === k)!)
    .map((s) => ({
      ...s,
      ...(s.key === 'overview' && needs && needs.count > 0
        ? { badge: needs.count, badgeTone: needs.severity === 'blocking' ? ('error' as const) : ('warning' as const), badgeLabel: attentionLabel(needs) }
        : {}),
    }))
  const moreItems: Tab[] = moreKeys.map((k) => {
    const s = [...screens, about, adoption, cleanup, requests].find((x) => x.key === k)!
    return { ...s, label: moreLabels[k] ?? s.label }
  })
  const places = useMemo(() => [...screens, about].map((s) => ({ id: s.key, label: s.label })), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  // An action that opens a place: "/settings/download-client" is the Settings screen at that
  // section, "/log?q=kind:failures" the Log with that filter.
  const goPath = useCallback(
    (path: string) => {
      const { screen: key, section, q } = placeOf(path)
      if (!isPlace(key)) return
      setScreen(key)
      setFilter({ screen: key, q })
      if (key === 'settings') {
        // A phone opens the section as its own screen; elsewhere it is scrolled to.
        setSettingsSection(section)
        if (phone && section) pushPlace(placePath('settings', '', section))
      }
      // Activity's sections are its tabs, not places to scroll to ("/activity/running" is Background Jobs).
      if (key === 'activity') setActivityTab(activityTabOf(section))
      else if (section && !(phone && key === 'settings')) setTimeout(() => document.getElementById(`${key}-${section}`)?.scrollIntoView?.(), 0)
    },
    [phone],
  )
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
        <EpisodeViewContext.Provider value={{ view: episodeView, setView: setEpisodeView }}>
          <div className="flex h-full">
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
              {/* The floating tab bar is out of layout; --tab-bar-height keeps every screen's last row clear of it (0 on a tablet or desktop). */}
              <BlockingBanner onOpen={goPath} />
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
                    tab={activityTab}
                    onTab={openActivityTab}
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
                  <Overview onOpen={goPath} onOpenTitle={openTitle} onOpenAdoption={() => setScreen('adoption')} />
                )}
              </main>
              {phone && (
                <PhoneTabBar tabs={tabs} screen={screen} moreActive={more || !tabKeys.includes(screen)} onSelect={select} onMore={() => setMore(true)} onSearch={() => setMenu({ mode: 'root' })} />
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
        </EpisodeViewContext.Provider>
      </PlaceOpener.Provider>
    </CleanupLauncher.Provider>
  )
}

/** The badge's words, shared by the rail and the phone tab bar; the tone is visual only, so Blocking is said here. */
function attentionLabel(a: { count: number; rows: { severity: string }[] }) {
  const blocking = a.rows.filter((r) => r.severity === 'blocking').length
  return `${a.count} ${a.count === 1 ? 'needs' : 'need'} attention${blocking > 0 ? `, ${blocking} blocking` : ''}`
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
  badge?: { count: number; tone: 'error' | 'warning'; label: string }
  children: ReactNode
}) {
  return (
    <Tooltip text={label} position="right">
      <Button
        svgOnly
        variant={active ? 'secondary' : 'tertiary'}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        badge={badge?.count}
        badgeTone={badge?.tone}
        badgeLabel={badge?.label}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

function Rail({ screen, onSelect, theme, onTheme, onAdd }: { screen: string; onSelect: (key: string) => void; theme: Theme; onTheme: (theme: Theme) => void; onAdd: () => void }) {
  const logout = useLogout()
  const auth = useAuth()
  const attention = useAttention().data
  const needs = attention?.count ?? 0
  return (
    <RailFrame>
      <span className="mb-2 inline-flex">
        <Button svgOnly variant="tertiary" aria-label="Kestrel, go to Overview" onClick={() => onSelect('overview')}>
          <KestrelLogo />
        </Button>
      </span>
      <RailButton label={`Add Title (${MOD} K)`} onClick={onAdd}>
        <Plus />
      </RailButton>
      <Separator className="my-1 w-6" />
      {screens.map((s) => (
        <RailButton
          key={s.key}
          label={s.label}
          active={screen === s.key}
          onClick={() => onSelect(s.key)}
          badge={s.key === 'overview' && needs > 0 ? { count: needs, tone: attention?.severity === 'blocking' ? 'error' : 'warning', label: attentionLabel(attention!) } : undefined}
        >
          {s.icon}
        </RailButton>
      ))}
      <RailSpacer />
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
    </RailFrame>
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
  // A phone has no room for the search box: the title, what runs and Add; Search is the tab bar's accessory.
  if (phone)
    return (
      <PhoneTopBar title={title}>
        <RunningIndicator running={running} onOpen={onOpenRunning} />
        <Button svgOnly variant="tertiary" aria-label="Add Title" onClick={onAdd}>
          <Plus />
        </Button>
      </PhoneTopBar>
    )
  return (
    <TopBarFrame
      title={title}
      end={
        <>
          <RunningIndicator running={running} onOpen={onOpenRunning} />
          <ServerStatus />
        </>
      }
    >
      {/* A button that opens the menu, styled as the search box it stands for. */}
      <CommandMenuTrigger size="small" aria-label="Search or run a command" onClick={onOpenMenu} className="w-full">
        Search or run a command…
      </CommandMenuTrigger>
    </TopBarFrame>
  )
}

/** Quiet while nothing runs; a dot and what runs, or how many things do, while work does. */
function RunningIndicator({ running, onOpen }: { running: Running[]; onOpen: () => void }) {
  if (running.length === 0) return null
  const [one] = running
  // The count takes the ellipsis's place: "Searching 15/40".
  const progress = one.progress?.total ? `${one.short.replace(/…$/, '')} ${one.progress.done}/${one.progress.total}` : null
  const label = running.length > 1 ? `${running.length} running` : (progress ?? one.short)
  return (
    <Button variant="tertiary" size="small" onClick={onOpen} title={running.map((r) => r.name).join('\n')} prefix={<StatusDot state="info" label={false} aria-hidden />}>
      {label}
    </Button>
  )
}

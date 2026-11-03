// The Geist shell: a thin icon rail, and beside it each screen's SidePanel (layout/SidePanel.tsx) or, for a screen without one, a plain title at the top of its content.
// Ported from the prototype's variant C; screens arrive with later tickets.
import { useRunningNow, type Running } from '../activity/running'
import { Button, Separator, StatusDot, ThemeSwitcher, Tooltip, useToasts } from '@hyprsh/design'
import { Activity as ActivityIcon, CalendarClock, Eraser, FolderInput, HeartPulse, Inbox, LibraryBig, ListPlus, Plus, ScrollText, Search, Settings } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAttention } from '../api/attention'
import { useAuth, useLogout } from '../api/queries'
import type { MenuAction, MenuMode } from '../command/CommandMenu'
import { adoptionLabel, useAdoption } from '../api/adoption'
import { CleanupLauncher } from '../cleanup/launch'
import { plural } from '../format'
import { MOD } from '../keys'
import { useSearchAllWanted } from '../api/wanted'
import { useSearchResultToasts } from '../activity/searchResultToast'
import { useSearchPassToast, useWatchSearch } from '../activity/searchToast'
import { startLiveStream } from '../live/stream'
import { useTrashOutcomeToasts } from '../trash/toasts'
import { EpisodeViewContext, noEpisodeView, type EpisodeView } from '../library/episodeView'
import { currentPlace, manualSearchPath, PlaceOpener, placeOf, placePath, pushedPlace, pushPlace, showPlace, type ManualSearchAt } from '../place'
import { usePhone } from '../responsive'
import { guardLeave } from '../settings/draft'
import { THEME_KEY, useTheme, type Theme } from '../theme'
import { ScreenSkeleton } from '../loading'
import { lazyScreen } from './lazyScreen'
import { KestrelLogo } from '../ui'
import { Rail as RailFrame, RailSpacer } from '../layout/Rail'
import { SidePanelPhoneContext } from '../layout/SidePanel'
import { PhoneTopBar } from '../layout/TopBar'
import { BlockingBanner } from './BlockingBanner'
import { MoreSheet, PhoneTabBar, type Tab } from './PhoneNav'
import { HealthButton } from './HealthButton'

// Each screen is its own chunk, so a cold load fetches the shell and the screen it opens at; the tab bar's screens follow when the browser is idle.
const lazyScreens = {
  overview: lazyScreen(() => import('../overview/Overview').then((m) => m.Overview)),
  library: lazyScreen(() => import('../library/Library').then((m) => m.Library)),
  upcoming: lazyScreen(() => import('../upcoming/Upcoming').then((m) => m.Upcoming)),
  activity: lazyScreen(() => import('../activity/Activity').then((m) => m.Activity)),
  log: lazyScreen(() => import('../log/Log').then((m) => m.Log)),
  health: lazyScreen(() => import('../health/Health').then((m) => m.Health)),
  requests: lazyScreen(() => import('../requests/Requests').then((m) => m.Requests)),
  settings: lazyScreen(() => import('../screens/Settings').then((m) => m.Settings)),
  adoption: lazyScreen(() => import('../adoption/Adoption').then((m) => m.Adoption)),
  cleanup: lazyScreen(() => import('../cleanup/Cleanup').then((m) => m.Cleanup)),
  menu: lazyScreen(() => import('../command/CommandMenu').then((m) => m.CommandMenu)),
}
const Overview = lazyScreens.overview.Screen
const Library = lazyScreens.library.Screen
const Upcoming = lazyScreens.upcoming.Screen
const Activity = lazyScreens.activity.Screen
const Log = lazyScreens.log.Screen
const Health = lazyScreens.health.Screen
const Requests = lazyScreens.requests.Screen
const SettingsScreen = lazyScreens.settings.Screen
const Adoption = lazyScreens.adoption.Screen
const Cleanup = lazyScreens.cleanup.Screen
// chrome-ok: the lazy Kestrel command-menu screen, not a copy of the design CommandMenu
const CommandMenu = lazyScreens.menu.Screen

// The rail, tab bar and More sheet items by the name they carry: pointing at, touching or focusing one fetches its screen at once.
const screenOfLabel: Record<string, keyof typeof lazyScreens> = {
  Overview: 'overview',
  Library: 'library',
  Upcoming: 'upcoming',
  Activity: 'activity',
  Log: 'log',
  Settings: 'settings',
  Requests: 'requests',
  Adoption: 'adoption',
  'Clean up': 'cleanup',
  Health: 'health',
}

/** Fetches a screen's chunk when its item is pointed at, touched or focused, ahead of the click that opens it. */
function prefetchOnIntent() {
  const onIntent = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('button, a')
    if (!el) return
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').split(',')[0].trim()
    const key = screenOfLabel[label]
    if (key) void lazyScreens[key].preload().catch(() => {})
  }
  const events = ['pointerover', 'pointerdown', 'focusin'] as const
  for (const ev of events) document.addEventListener(ev, onIntent, true)
  return () => {
    for (const ev of events) document.removeEventListener(ev, onIntent, true)
  }
}

/** Fetches the chunks of the tab bar's screens and the command menu once the first screen has settled, one at a time, unless the browser asks to save data. */
function prefetchScreens() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return () => {}
  const order = [lazyScreens.library, lazyScreens.upcoming, lazyScreens.activity, lazyScreens.overview, lazyScreens.menu]
  let cancelled = false
  let handle: number | undefined
  const idle = (f: () => void) => (typeof requestIdleCallback === 'function' ? (requestIdleCallback(f, { timeout: 5000 }) as number) : (window.setTimeout(f, 1500) as unknown as number))
  const next = (i: number) => {
    if (cancelled || i >= order.length) return
    handle = idle(() => {
      order[i].preload().then(
        () => next(i + 1),
        () => {}, // offline: the screen fetches itself when opened
      )
    })
  }
  const start = window.setTimeout(() => next(0), 2000)
  return () => {
    cancelled = true
    clearTimeout(start)
    if (handle !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  }
}

const screens = [
  { key: 'overview', label: 'Overview', icon: <Inbox /> },
  { key: 'library', label: 'Library', icon: <LibraryBig /> },
  { key: 'upcoming', label: 'Upcoming', icon: <CalendarClock /> },
  { key: 'activity', label: 'Activity', icon: <ActivityIcon /> },
  { key: 'log', label: 'Log', icon: <ScrollText /> },
  { key: 'settings', label: 'Settings', icon: <Settings /> },
]
// Reached from Settings and the command menu, not the rail.
const adoption = { key: 'adoption', label: 'Adopt existing library', icon: <FolderInput /> }
const cleanup = { key: 'cleanup', label: 'Clean up Unmanaged files', icon: <Eraser /> }
// Reached from the Overview's Recent requests, not the rail; a place, so "/requests?q=…" opens it.
const requests = { key: 'requests', label: 'Requests', icon: <ListPlus /> }
// Reached from the Health button (rail and phone top bar), not the screen list; a place, so "/health" opens it.
const health = { key: 'health', label: 'Health', icon: <HeartPulse /> }
// The tab bar of a phone; the rest of the screens are behind More.
const tabKeys = ['overview', 'library', 'upcoming', 'activity']
// Settings and Log first, then the screens a phone reaches only from here (Requests also from the Overview). About is a page of Settings.
const moreKeys = ['settings', 'log', 'requests', 'adoption', 'cleanup']
// Short names for the More sheet; a screen's heading keeps the long ones.
const moreLabels: Record<string, string> = { adoption: 'Adoption', cleanup: 'Clean up' }
// The screens that carry their own name in a SidePanel (see layout/SidePanel.tsx), so the Shell adds no heading above them.
// Phase 2 adds Log, Upcoming, Settings, Activity and Health as they move over.
const panelScreens = ['overview', 'library', 'activity', 'health', 'settings', 'upcoming', 'log', 'requests']
const isTitleId = (section: string) => /^\d+$/.test(section)
const isPlace = (key: string) => [...screens, requests, health].some((s) => s.key === key)

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
    start.screen === 'library' && (start.season !== null || start.slot || start.open)
      ? { titleId: startTitle, season: start.season, episode: start.episode, slot: start.slot, open: start.open }
      : noEpisodeView,
  )
  // A Title's Manual search ("/library/12/search?version=4&scope=S05"): it replaces the Title page and has its own address.
  const [manual, setManual] = useState<ManualSearchAt | null>(start.search)
  // On a phone Settings' list and an opened section are two screens; "/settings/indexers" is the second.
  const [settingsSection, setSettingsSection] = useState(start.screen === 'settings' ? start.section : '')
  const [more, setMore] = useState(false)
  const [cleanupTitles, setCleanupTitles] = useState<number[] | undefined>(undefined)
  const [menu, setMenu] = useState<{ mode: MenuMode } | null>(null)
  // The text of a screen's filter field (the Library's or the Log's); another screen starts unfiltered.
  const [filter, setFilter] = useState({ screen: start.screen, q: start.q })
  const query = filter.screen === screen ? filter.q : ''
  // The search belongs to the Library and to its Title: another screen or Title closes it.
  const searchShown = screen === 'library' && manual !== null && manual.titleId === libraryId ? manual : null
  useEffect(() => {
    if (manual !== null && (screen !== 'library' || manual.titleId !== libraryId)) setManual(null)
  }, [manual, screen, libraryId])
  const section = !phone ? '' : screen === 'library' ? (titleOpen && libraryId !== null ? String(libraryId) : '') : screen === 'settings' ? settingsSection : ''
  // Health's section ("/health/jobs") is scrolled to; the address keeps it until the screen changes.
  const [healthSection, setHealthSection] = useState(start.screen === 'health' ? start.section : '')
  // Another Title selected: its Series' season and found episode are not the previous Title's (a Movie shows none). A view that names no Title stays for the first Series shown.
  useEffect(() => {
    if (libraryId !== null) setEpisodeView((v) => (v.titleId !== null && v.titleId !== libraryId ? noEpisodeView : v))
  }, [libraryId])
  const shownView = screen === 'library' ? episodeView : noEpisodeView
  const address = { q: query, section: screen === 'health' ? healthSection : section }
  useEffect(() => showPlace(placePath(screen, address.q, address.section, shownView, searchShown)), [screen, address.q, address.section, shownView, searchShown])
  // A first load at "/health/jobs" scrolls to that section.
  useEffect(() => {
    if (start.screen === 'health' && start.section) document.getElementById(`health-${start.section}`)?.scrollIntoView?.()
  }, [start])
  // Back and Forward step between the list and a Title page (and the screen a Title was opened from).
  useEffect(() => {
    const onPop = () => {
      const place = currentPlace()
      if (isPlace(place.screen)) setScreen(place.screen)
      if (place.screen === 'health') setHealthSection(place.section)
      setFilter({ screen: place.screen, q: place.q })
      setTitleOpen(isTitleId(place.section))
      setManual(place.search)
      setEpisodeView(
        place.season === null && !place.slot ? noEpisodeView : { titleId: isTitleId(place.section) ? Number(place.section) : null, season: place.season, episode: place.episode, slot: place.slot },
      )
      setSettingsSection(place.screen === 'settings' ? place.section : '')
      if (isTitleId(place.section)) setLibraryId(Number(place.section))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const { theme, setTheme, cycle } = useTheme()
  const auth = useAuth()
  const logout = useLogout()
  const current = [...screens, adoption, cleanup, requests, health].find((s) => s.key === screen)!
  const running = useRunningNow()
  // What a phone's header shows before the screen's own actions: what runs and Health. A desktop has them in the rail.
  const phoneExtras = (
    <>
      <RunningIndicator running={running} onOpen={() => goPath('/health/jobs')} phone />
      <HealthButton tooltipPosition="bottom" active={screen === 'health'} />
    </>
  )

  // Every open tab stays live through one shared stream; the cache refetches on its hints.
  const queryClient = useQueryClient()
  useEffect(() => startLiveStream(queryClient), [queryClient])
  useEffect(() => prefetchScreens(), [])
  useEffect(() => prefetchOnIntent(), [])

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
  useSearchPassToast()
  const watchSearch = useWatchSearch()
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
            onSuccess: (versions) => watchSearch(`${versions} Wanted ${versions === 1 ? 'Version' : 'Versions'} queued for a search`),
            onError: (e) => toasts.error(`Search all Wanted failed: ${e.message}`),
          }),
      },
      { id: 'theme', label: 'Switch theme', keywords: 'dark light mode', run: cycle },
      { id: 'setup', label: 'Run setup again', keywords: 'wizard', run: onRunSetup },
      { id: 'adopt', label: adoptionLabel(adoptionState), keywords: 'adopt adoption existing library import', run: () => setScreen('adoption') },
      { id: 'cleanup', label: 'Clean up Unmanaged files', keywords: 'junk samples subtitles delete tidy', run: () => openCleanup() },
      ...(canLogout ? [{ id: 'logout', label: 'Log Out', keywords: 'sign out logout', run: () => logout.mutate(undefined) }] : []),
    ],
    [cycle, onRunSetup, canLogout, logout, searchAllWanted, toasts, watchSearch, openCleanup, adoptionState],
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
    const s = [...screens, adoption, cleanup, requests].find((x) => x.key === k)!
    return { ...s, label: moreLabels[k] ?? s.label }
  })
  const places = useMemo(() => [...screens, health, { key: 'about', label: 'About' }].map((s) => ({ id: s.key, label: s.label })), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  // Opens a Title's Manual search as a new history entry, so Back returns to where it was opened from; null closes it the same way.
  const openSearch = useCallback((at: ManualSearchAt) => {
    setLibraryId(at.titleId)
    setFilter({ screen: 'library', q: '' })
    setScreen('library')
    setTitleOpen(true)
    setManual(at)
    pushPlace(manualSearchPath(at))
  }, [])
  const closeSearch = useCallback(() => {
    if (pushedPlace()) history.back()
    else setManual(null)
  }, [])
  // An action that opens a place: "/settings/download-client" is the Settings screen at that
  // section, "/log?q=kind:failures" the Log with that filter.
  const goPath = useCallback(
    (path: string) => {
      const { screen: key, section, q, search } = placeOf(path)
      if (!isPlace(key)) return
      if (search) {
        guardLeave(() => openSearch(search))
        return
      }
      const go = () => {
        setScreen(key)
        setFilter({ screen: key, q })
        if (key === 'settings') {
          // A phone opens the section as its own screen; elsewhere it is scrolled to.
          setSettingsSection(section)
          if (phone && section) pushPlace(placePath('settings', '', section))
        }
        if (key === 'health') setHealthSection(section)
        if (section && !(phone && key === 'settings')) setTimeout(() => document.getElementById(`${key}-${section}`)?.scrollIntoView?.(), 0)
      }
      // Unsaved Settings are asked about, unless the place is Settings itself (it asks on its own when the page changes).
      if (key === 'settings') go()
      else guardLeave(go)
    },
    [phone, openSearch],
  )
  useSearchResultToasts(goPath)
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
    guardLeave(() => {
      setScreen(key)
      if (key === 'library') setTitleOpen(false)
      if (key === 'settings') setSettingsSection('')
    })
  }, [])

  return (
    <CleanupLauncher.Provider value={openCleanup}>
      <PlaceOpener.Provider value={goPath}>
        <EpisodeViewContext.Provider value={{ view: episodeView, setView: setEpisodeView }}>
          <SidePanelPhoneContext.Provider value={phoneExtras}>
            <div className="flex h-full">
              {!phone && (
                <Rail
                  screen={screen}
                  onSelect={(key) => guardLeave(() => setScreen(key))}
                  running={running}
                  onOpenRunning={() => goPath('/health/jobs')}
                  theme={theme}
                  onTheme={setTheme}
                  onSearch={() => setMenu({ mode: 'root' })}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                {phone && !panelScreens.includes(screen) && (
                  <PhoneTopBar title={current.label}>
                    {phoneExtras}
                    <Button svgOnly variant="tertiary" aria-label="Add Title" onClick={() => setMenu({ mode: 'add' })}>
                      <Plus />
                    </Button>
                  </PhoneTopBar>
                )}
                {/* The floating tab bar is out of layout; --tab-bar-height keeps every screen's last row clear of it (0 on a tablet or desktop). */}
                <BlockingBanner onOpen={goPath} />
                <main className="flex min-h-0 flex-1 flex-col pb-[var(--tab-bar-height)]">
                  <Suspense fallback={<ScreenSkeleton />}>
                    {screen === 'settings' ? (
                      <SettingsScreen
                        onRunSetup={onRunSetup}
                        onAdopt={() => setScreen('adoption')}
                        section={settingsSection}
                        onOpenSection={openSettingsSection}
                        onCloseSection={closeSettingsSection}
                      />
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
                        search={searchShown}
                        onSearch={(at) => (at ? openSearch(at) : closeSearch())}
                      />
                    ) : screen === 'log' ? (
                      <Log query={query} onQuery={(q) => setFilter({ screen: 'log', q })} onOpenTitle={openTitle} />
                    ) : screen === 'activity' ? (
                      <Activity query={query} onQuery={(q) => setFilter({ screen: 'activity', q })} onOpenTitle={openTitle} />
                    ) : screen === 'health' ? (
                      <Health running={running} onOpenAdoption={() => setScreen('adoption')} onOpenTitle={openTitle} />
                    ) : screen === 'requests' ? (
                      <Requests query={query} onQuery={(q) => setFilter({ screen: 'requests', q })} onOpenTitle={openTitle} />
                    ) : screen === 'upcoming' ? (
                      <Upcoming query={query} onQuery={(q) => setFilter({ screen: 'upcoming', q })} onOpenTitle={openTitle} />
                    ) : (
                      <Overview onOpen={goPath} onOpenTitle={openTitle} onOpenAdoption={() => setScreen('adoption')} />
                    )}
                  </Suspense>
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
              {menu && (
                <Suspense fallback={null}>
                  <CommandMenu
                    initialMode={menu.mode}
                    actions={actions}
                    places={places}
                    onClose={closeMenu}
                    onGo={(place) => (place === 'about' ? goPath('/settings/about') : setScreen(place))}
                    onOpenTitle={openTitle}
                  />
                </Suspense>
              )}
            </div>
          </SidePanelPhoneContext.Provider>
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

function Rail({
  screen,
  onSelect,
  theme,
  onTheme,
  onSearch,
  running,
  onOpenRunning,
}: {
  screen: string
  onSelect: (key: string) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  onSearch: () => void
  running: Running[]
  onOpenRunning: () => void
}) {
  const attention = useAttention().data
  const needs = attention?.count ?? 0
  return (
    <RailFrame>
      {/* The mark is the Overview link (home), with its attention badge, and active like the other screens. */}
      <RailButton
        label="Overview"
        active={screen === 'overview'}
        onClick={() => onSelect('overview')}
        badge={needs > 0 ? { count: needs, tone: attention?.severity === 'blocking' ? 'error' : 'warning', label: attentionLabel(attention!) } : undefined}
      >
        <KestrelLogo />
      </RailButton>
      {/* One entry point: the command menu searches the Library and, with "Add Title…", the Movies and Series to add. */}
      <RailButton label={`Search or add (${MOD} K)`} onClick={onSearch}>
        <Search />
      </RailButton>
      <Separator className="my-1 w-6" />
      {screens
        .filter((s) => s.key !== 'overview' && s.key !== 'settings')
        .map((s) => (
          <RailButton key={s.key} label={s.label} active={screen === s.key} onClick={() => onSelect(s.key)}>
            {s.icon}
          </RailButton>
        ))}
      <RailSpacer />
      <RailRunning running={running} onOpen={onOpenRunning} />
      {/* Applies the choice to <html> and saves it; the command menu's "Switch theme" moves it through the same value. */}
      <HealthButton tooltipPosition="right" active={screen === 'health'} />
      <ThemeSwitcher variant="cycle" attribute="class" storageKey={THEME_KEY} value={theme} onChange={onTheme} tooltipPosition="right" />
      {/* Last of the bottom group, below Health and the theme switcher. */}
      <RailButton label="Settings" active={screen === 'settings'} onClick={() => onSelect('settings')}>
        <Settings />
      </RailButton>
    </RailFrame>
  )
}

/** What runs, in a few words: "Searching 15/40", "Searching 1/4 · 12 releases" (off a phone's narrow header), or how many things run. */
function runningLabel(running: Running[], phone: boolean) {
  const [one] = running
  // The count takes the ellipsis's place: "Searching 15/40". A search pass adds the Releases checked, off a phone's narrow bar.
  const counted = one.progress?.total ? `${one.short.replace(/…$/, '')} ${one.progress.done}/${one.progress.total}` : null
  const progress = counted && one.releases && !phone ? `${counted} · ${plural(one.releases, 'release')}` : counted
  return running.length > 1 ? `${running.length} running` : (progress ?? one.short)
}

/** The tooltip, which a screen reader gets as the description, names what runs and what is searched now. */
const runningTip = (running: Running[]) => running.map((r) => (r.now ? `${r.name}\n${r.now}` : r.name)).join('\n')

/** A phone header's mark for work in progress: a dot and what runs, or how many things do. Quiet while nothing runs. */
function RunningIndicator({ running, onOpen, phone = false }: { running: Running[]; onOpen: () => void; phone?: boolean }) {
  if (running.length === 0) return null
  return (
    <Button variant="tertiary" size="small" className="min-w-0 [&_span]:truncate" onClick={onOpen} title={runningTip(running)} prefix={<StatusDot state="info" label={false} aria-hidden />}>
      {runningLabel(running, phone)}
    </Button>
  )
}

/** The rail's mark for work in progress: a dot that opens the jobs, named by what runs (the same words a phone's header shows). */
function RailRunning({ running, onOpen }: { running: Running[]; onOpen: () => void }) {
  if (running.length === 0) return null
  return (
    <Button svgOnly variant="tertiary" aria-label={runningLabel(running, false)} title={runningTip(running)} onClick={onOpen}>
      <StatusDot state="info" label={false} aria-hidden />
    </Button>
  )
}

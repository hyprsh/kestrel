// Where the SPA is, as one path: the screen, a section of it and its filter, such as
// "/settings/download-client" or "/log?q=kind:failures". Attention actions and in-app links name
// places this way, and the address bar shows the current one (relative to the <base href>, which
// the server serves index.html under), so a filtered screen can be bookmarked or linked to.
// There is no router: the Shell switches screens, opens paths and keeps the address bar in step.
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

/** The season tab (0 is Specials) and the found episode's number of a Series' Title page; null: not set. */
export type EpisodeAt = { season: number | null; episode: number | null }

export type Place = { screen: string; section: string; q: string } & EpisodeAt

/**
 * The path of a screen with its filter text, and a section of it such as an open Title's id on a phone. A Series'
 * season tab and found episode follow as `season` and `episode` ("/library?season=2&episode=5").
 */
export function placePath(screen: string, q = '', section = '', at?: EpisodeAt): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (at?.season != null) params.set('season', String(at.season))
  if (at?.season != null && at.episode != null) params.set('episode', String(at.episode))
  const query = params.toString()
  return `/${screen}${section ? `/${section}` : ''}${query ? `?${query}` : ''}`
}

const count = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null)

/** Reads a path such as "/settings/download-client" or "/log?q=kind:grab". */
export function placeOf(path: string): Place {
  const url = new URL(path.replace(/^\/*/, '/'), 'http://place')
  const [screen = '', section = ''] = url.pathname.slice(1).split('/')
  const season = count(url.searchParams.get('season'))
  return { screen, section, q: url.searchParams.get('q') ?? '', season, episode: season === null ? null : count(url.searchParams.get('episode')) }
}

/** The directory the SPA is served under: "/" or the base URL's path. */
const root = () => new URL(document.querySelector('base')?.href ?? '/', location.origin).pathname.replace(/\/?$/, '/')

/** The place in the address bar. */
export function currentPlace(): Place {
  const r = root()
  const path = location.pathname.startsWith(r) ? location.pathname.slice(r.length) : ''
  return placeOf(`/${path}${location.search}`)
}

/** The address-bar parameters a screen's list view keeps beside the filter: the page and the sort. */
const viewParams = ['page', 'sort']

const placeURL = (path: string) => {
  const url = new URL(path === '/overview' ? '' : path.replace(/^\/+/, ''), new URL(root(), location.origin))
  // The same screen keeps its page and sort when the filter or a section changes; another screen starts without.
  if (url.pathname === location.pathname) {
    const now = new URLSearchParams(location.search)
    for (const name of viewParams) if (now.has(name) && !url.searchParams.has(name)) url.searchParams.set(name, now.get(name)!)
  }
  return url
}

const urlListeners = new Set<() => void>()
const urlChanged = () => urlListeners.forEach((l) => l())
const subscribeUrl = (l: () => void) => {
  urlListeners.add(l)
  window.addEventListener('popstate', l)
  return () => {
    urlListeners.delete(l)
    window.removeEventListener('popstate', l)
  }
}

/** Shows `path` in the address bar without adding a history entry; the Overview is the root. */
export function showPlace(path: string): void {
  const url = placeURL(path)
  if (url.href !== location.href) {
    history.replaceState(history.state, '', url)
    urlChanged()
  }
}

/** Shows `path` as a new history entry, so the browser's Back returns to where it was (a Title page opened from a list). */
export function pushPlace(path: string): void {
  const url = placeURL(path)
  if (url.href !== location.href) {
    history.pushState({ pushedPlace: true }, '', url)
    urlChanged()
  }
}

/**
 * One list-view parameter of the address bar (`page` or `sort`), kept with `replaceState` so it adds no history entry.
 * `null` removes it. The Shell keeps it while the screen stays the same and drops it on another screen.
 */
export function useUrlParam(name: 'page' | 'sort'): [string | null, (value: string | null) => void] {
  const search = useSyncExternalStore(subscribeUrl, () => location.search)
  const set = useCallback(
    (value: string | null) => {
      const url = new URL(location.href)
      if (value === null) url.searchParams.delete(name)
      else url.searchParams.set(name, value)
      if (url.href === location.href) return
      history.replaceState(history.state, '', url)
      urlChanged()
    },
    [name],
  )
  return [new URLSearchParams(search).get(name), set]
}

/** The list page in the address bar (`?page=3`), from 1; page 1 leaves the address bar clean. */
export function usePageParam(): [number, (page: number) => void] {
  const [value, set] = useUrlParam('page')
  const page = Math.max(1, Math.floor(Number(value)) || 1)
  return [page, useCallback((next: number) => set(next > 1 ? String(next) : null), [set])]
}

/** Whether the current history entry was added by `pushPlace`, so Back stays inside the app. */
export const pushedPlace = (): boolean => history.state?.pushedPlace === true

/**
 * Opens a place by its path. The Shell provides it, so a screen links to another (a Title page
 * to its Log) without knowing how screens are switched.
 */
export const PlaceOpener = createContext<(path: string) => void>(() => {})

export const useOpenPlace = () => useContext(PlaceOpener)

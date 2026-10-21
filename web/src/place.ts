// Where the SPA is, as one path: the screen, a section of it and its filter, such as
// "/settings/download-client" or "/log?q=kind:failures". Attention actions and in-app links name
// places this way, and the address bar shows the current one (relative to the <base href>, which
// the server serves index.html under), so a filtered screen can be bookmarked or linked to.
// There is no router: the Shell switches screens, opens paths and keeps the address bar in step.
import { createContext, useContext } from 'react'

export type Place = { screen: string; section: string; q: string }

/** The path of a screen with its filter text. */
export function placePath(screen: string, q = ''): string {
  return `/${screen}${q ? `?${new URLSearchParams({ q })}` : ''}`
}

/** Reads a path such as "/settings/download-client" or "/log?q=kind:grab". */
export function placeOf(path: string): Place {
  const url = new URL(path.replace(/^\/*/, '/'), 'http://place')
  const [screen = '', section = ''] = url.pathname.slice(1).split('/')
  return { screen, section, q: url.searchParams.get('q') ?? '' }
}

/** The directory the SPA is served under: "/" or the base URL's path. */
const root = () => new URL(document.querySelector('base')?.href ?? '/', location.origin).pathname.replace(/\/?$/, '/')

/** The place in the address bar. */
export function currentPlace(): Place {
  const r = root()
  const path = location.pathname.startsWith(r) ? location.pathname.slice(r.length) : ''
  return placeOf(`/${path}${location.search}`)
}

/** Shows `path` in the address bar without adding a history entry; the Overview is the root. */
export function showPlace(path: string): void {
  const url = new URL(path === '/overview' ? '' : path.replace(/^\/+/, ''), new URL(root(), location.origin))
  if (url.href !== location.href) history.replaceState(history.state, '', url)
}

/**
 * Opens a place by its path. The Shell provides it, so a screen links to another (a Title page
 * to its Log) without knowing how screens are switched.
 */
export const PlaceOpener = createContext<(path: string) => void>(() => {})

export const useOpenPlace = () => useContext(PlaceOpener)

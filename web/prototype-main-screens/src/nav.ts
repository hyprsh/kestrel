// PROTOTYPE, throwaway. URL search params as the only router, so every screen is shareable and reload-stable.
import { useSyncExternalStore } from 'react'

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  window.addEventListener('kestrel:nav', cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener('kestrel:nav', cb)
  }
}

export function useParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search)
  return new URLSearchParams(search)
}

export function useParam(key: string, fallback = ''): string {
  return useParams().get(key) ?? fallback
}

/** Merge params into the URL; pass null to delete a key. `variant` is always kept. */
export function navigate(next: Record<string, string | null>, replace = false) {
  const p = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(next)) v === null ? p.delete(k) : p.set(k, v)
  const url = `${window.location.pathname}?${p.toString()}`
  replace ? history.replaceState(null, '', url) : history.pushState(null, '', url)
  window.dispatchEvent(new Event('kestrel:nav'))
}

/** Go to a screen, clearing per-screen params but keeping the variant. */
export function go(screen: string, extra: Record<string, string> = {}) {
  const variant = new URLSearchParams(window.location.search).get('variant')
  const p = new URLSearchParams({ ...(variant ? { variant } : {}), screen, ...extra })
  history.pushState(null, '', `${window.location.pathname}?${p.toString()}`)
  window.dispatchEvent(new Event('kestrel:nav'))
}

// The breakpoints, as Tailwind has them: phone is below `sm` (640px) and tablet below `lg` (1024px).
// CSS adjusts a screen's look with `max-sm:` and `max-lg:`; this hook is for the screens that change
// structure on a phone (the shell's tab bar, the Library's list and Title page as two screens), so
// a test can set the viewport with matchMedia. Without matchMedia it is a desktop.
import { useSyncExternalStore } from 'react'

const PHONE = '(max-width: 639.98px)'

const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE) : null)

/** Whether the viewport is a phone's. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = query()
      m?.addEventListener('change', notify)
      return () => m?.removeEventListener('change', notify)
    },
    () => query()?.matches ?? false,
  )
}

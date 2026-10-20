import { useEffect, useEffectEvent } from 'react'

/** How long a notice that something started in the background stays up. */
const fadeMs = 8000

/**
 * Clears a notice a few seconds after it shows, such as "Searching… The Log
 * shows what it grabs": the work goes on in the background, so the notice has
 * nothing more to say. `notice` is null while none shows; a new one starts the
 * wait over.
 */
export function useFade(notice: unknown, clear: () => void, ms = fadeMs) {
  const onFade = useEffectEvent(clear)
  useEffect(() => {
    if (notice === null || notice === undefined) return
    const t = setTimeout(() => onFade(), ms)
    return () => clearTimeout(t)
  }, [notice, ms])
}

import { Spinner } from '@hyprsh/design'
import { useEffect, useState } from 'react'

/** The design's advice for a Spinner: show it only after about 300ms, so a quick load does not flash it. */
const showAfterMs = 300

/** True once `on` has held for `ms`, so something shown only for a slow wait stays hidden for a quick one. */
export function useAfter(ms: number, on = true): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) {
      setLate(false)
      return
    }
    const t = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return late
}

/** Waits for typing to pause before a value is used, so a search is not sent per keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** A Spinner with text, such as "Loading…", that appears only once the wait passes about 300ms. */
export function LoadingLine({ children }: { children: string }) {
  const late = useAfter(showAfterMs)
  if (!late) return null
  return (
    <p className="label-13 flex items-center gap-2 text-gray-900">
      <Spinner size="sm" />
      {children}
    </p>
  )
}

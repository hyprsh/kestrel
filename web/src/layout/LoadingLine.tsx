// chrome: layout
import { Spinner } from '@hyprsh/design'
import { useEffect, useState } from 'react'

/** The design's advice for a Spinner: show it only after about 300ms, so a quick load does not flash it. */
const showAfterMs = 300

/** A Spinner with text, such as "Loading…", that appears only once the wait passes about 300ms. */
export function LoadingLine({ children }: { children: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), showAfterMs)
    return () => clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <p className="flex items-center gap-2 text-gray-900">
      <Spinner size="sm" />
      {children}
    </p>
  )
}

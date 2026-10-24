import { useEffect, useState } from 'react'

/** True once `on` has held for `ms`, so something shown only for a slow wait stays hidden for a quick one. */
export function useAfter(on: boolean, ms: number): boolean {
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

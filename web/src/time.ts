// Relative times for live screens: "5 min ago", "for 2 h 5 min", re-rendered as the clock moves.
import { useEffect, useState } from 'react'

/** Re-renders every half minute, so relative times count on between frames. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** A stretch of time, rounded to what matters at its size: "45 s", "3 min", "2 h 5 min", "3 d 4 h". */
export function span(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  if (secs < 60) return `${secs} s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return mins % 60 ? `${hours} h ${mins % 60} min` : `${hours} h`
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`
}

/** "just now" or "5 min ago". */
export function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso)
  return ms < 60_000 ? 'just now' : `${span(ms)} ago`
}

/** "in 3 min", or "any moment" once it is due. */
export function until(iso: string, now: number): string {
  const ms = Date.parse(iso) - now
  return ms <= 0 ? 'any moment' : `in ${span(ms)}`
}

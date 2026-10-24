import { useCallback, useMemo, useState } from 'react'
import { useEpisodes, type Episode } from '../api/queries'

/** Which seasons of a Series' episode grid show their episodes, and the means to open and close them. */
export type SeasonOpen = {
  isOpen: (season: number) => boolean
  set: (season: number, open: boolean) => void
  setAll: (open: boolean) => void
  /** The seasons of the Series, in order. */
  seasons: number[]
}

type Overrides = Record<number, boolean>

const key = (titleId: number) => `kestrel.seasons.${titleId}`

// localStorage can be missing or throw (private mode, blocked storage): then nothing is remembered.
function load(titleId: number): Overrides {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(titleId)) ?? '{}')
    if (!v || typeof v !== 'object') return {}
    return Object.fromEntries(Object.entries(v).filter(([s, open]) => Number.isInteger(Number(s)) && typeof open === 'boolean'))
  } catch {
    return {}
  }
}

function save(titleId: number, overrides: Overrides) {
  try {
    localStorage.setItem(key(titleId), JSON.stringify(overrides))
  } catch {
    // not remembered
  }
}

/**
 * A season opens by default when it is the latest one or has Wanted episodes;
 * Specials and every other season start closed.
 */
function openByDefault(season: number, latest: number, episodes: Episode[]): boolean {
  if (season === 0) return false
  return season === latest || episodes.some((e) => Object.values(e.cells).some((c) => c?.state === 'wanted'))
}

/**
 * The open or closed seasons of one Series. A season the user opens or closes
 * overrides the default and is remembered for the Series in localStorage, so
 * it stays that way when the Series is shown again. Nothing goes to the server.
 */
export function useSeasonOpen(titleId: number): SeasonOpen {
  const episodes = useEpisodes(titleId)
  const [stored, setStored] = useState(() => ({ titleId, overrides: load(titleId) }))
  // Another Series: its own remembered seasons.
  let current = stored
  if (stored.titleId !== titleId) {
    current = { titleId, overrides: load(titleId) }
    setStored(current)
  }
  const overrides = current.overrides
  const change = useCallback(
    (next: (o: Overrides) => Overrides) =>
      setStored((s) => {
        const overrides = next(s.overrides)
        save(s.titleId, overrides)
        return { ...s, overrides }
      }),
    [],
  )

  const bySeason = useMemo(() => {
    const m = new Map<number, Episode[]>()
    for (const e of episodes.data ?? []) m.set(e.season, [...(m.get(e.season) ?? []), e])
    return m
  }, [episodes.data])
  const seasons = useMemo(() => [...bySeason.keys()], [bySeason])
  const latest = Math.max(0, ...seasons)

  const isOpen = useCallback((season: number) => overrides[season] ?? openByDefault(season, latest, bySeason.get(season) ?? []), [overrides, latest, bySeason])
  const set = useCallback((season: number, open: boolean) => change((o) => ({ ...o, [season]: open })), [change])
  const setAll = useCallback((open: boolean) => change(() => Object.fromEntries(seasons.map((s) => [s, open]))), [change, seasons])

  return useMemo(() => ({ isOpen, set, setAll, seasons }), [isOpen, set, setAll, seasons])
}

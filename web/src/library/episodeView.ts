// Which seasons of a Series' Title page are open, which episode was found and which Slot the page was opened at, kept where
// the address bar can show them. The Shell provides the state and writes it to the address ("/library?open=5,3&slot=4k", or
// "?season=2&episode=5" for a found episode); without a provider (a test, a page rendered alone) the state is local to the page.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/** The state of the Title `titleId` (null: read from an address that names no Title, so the first Series shown takes it). */
export type EpisodeView = {
  titleId: number | null
  season: number | null
  episode: number | null
  /** The Slot the page was opened at: its row is opened, scrolled to and marked. */
  slot?: string | null
  /** The seasons open ("?open=5,3"); null: the address names none, so `season` (the old "?season=N") or the page's own choice stands. */
  open?: number[] | null
}

export const noEpisodeView: EpisodeView = { titleId: null, season: null, episode: null }

export const EpisodeViewContext = createContext<{ view: EpisodeView; setView: (view: EpisodeView) => void } | null>(null)

/** The open seasons, found episode and Slot of one Title, and the means to change them. */
export function useEpisodeView(titleId: number): {
  season: number | null
  episode: number | null
  slot: string | null
  open: number[] | null
  /** Names the season and episode found (the season opens too); the open seasons and the Slot stay. */
  set: (season: number | null, episode: number | null) => void
  setOpen: (open: number[]) => void
  /** Goes to a found episode: names it and its season, and the seasons to have open. */
  found: (season: number, episode: number, open: number[]) => void
} {
  const [local, setLocal] = useState(noEpisodeView)
  const shared = useContext(EpisodeViewContext)
  const view = shared?.view ?? local
  const setView = shared?.setView ?? setLocal
  const mine = view.titleId === titleId || view.titleId === null
  const set = useCallback((season: number | null, episode: number | null) => setView({ ...view, titleId, season, episode }), [setView, view, titleId])
  const setOpen = useCallback((open: number[]) => setView({ ...view, titleId, open, season: view.episode === null ? null : view.season }), [setView, view, titleId])
  const found = useCallback((season: number, episode: number, open: number[]) => setView({ ...view, titleId, season, episode, open }), [setView, view, titleId])
  // An address that named a season, seasons or a Slot but no Title belongs to the first Title that shows it; another Title's view does not stay in the address.
  useEffect(() => {
    if (view.titleId === null && (view.season !== null || view.slot || view.open)) setView({ ...view, titleId })
    else if (view.titleId !== null && view.titleId !== titleId) setView({ titleId, season: null, episode: null })
  }, [view, setView, titleId])
  return { season: mine ? view.season : null, episode: mine ? view.episode : null, slot: mine ? (view.slot ?? null) : null, open: mine ? (view.open ?? null) : null, set, setOpen, found }
}

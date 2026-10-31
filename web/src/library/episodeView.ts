// Which season tab of a Series' Title page is open and which episode was found, kept where the address bar can
// show them. The Shell provides the state and writes it to the address ("/library?season=2&episode=5"); without
// a provider (a test, a page rendered alone) the state is local to the page.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/** The state of the Title `titleId` (null: read from an address that names no Title, so the first Series shown takes it). */
export type EpisodeView = { titleId: number | null; season: number | null; episode: number | null }

export const noEpisodeView: EpisodeView = { titleId: null, season: null, episode: null }

export const EpisodeViewContext = createContext<{ view: EpisodeView; setView: (view: EpisodeView) => void } | null>(null)

/** The open season tab and found episode (the episode's number in its season) of one Title, and the means to change them. */
export function useEpisodeView(titleId: number): { season: number | null; episode: number | null; set: (season: number | null, episode: number | null) => void } {
  const [local, setLocal] = useState(noEpisodeView)
  const shared = useContext(EpisodeViewContext)
  const view = shared?.view ?? local
  const setView = shared?.setView ?? setLocal
  const mine = view.titleId === titleId || view.titleId === null
  const set = useCallback((season: number | null, episode: number | null) => setView({ titleId, season, episode }), [setView, titleId])
  // An address that named a season but no Title belongs to the first Series that shows it; another Title's season does not stay in the address.
  useEffect(() => {
    if (view.titleId === null && view.season !== null) set(view.season, view.episode)
    else if (view.titleId !== null && view.titleId !== titleId) set(null, null)
  }, [view, set, titleId])
  return { season: mine ? view.season : null, episode: mine ? view.episode : null, set }
}

import { createContext, useContext } from 'react'

/**
 * Opens the Clean up screen, for the named Titles or (without ids) for every
 * tracked Title. The shell provides it; the Library header, a Title and the
 * Adoption result use it, so none of them knows how screens are switched.
 */
export const CleanupLauncher = createContext<(titleIds?: number[]) => void>(() => {})

export const useOpenCleanup = () => useContext(CleanupLauncher)

import { createContext, useContext } from 'react'

/**
 * Opens the Clean up screen, for one Title or (without an id) for every
 * tracked Title. The shell provides it; the Library header, a Title and the
 * Adoption result use it, so none of them knows how screens are switched.
 */
export const CleanupLauncher = createContext<(titleId?: number) => void>(() => {})

export const useOpenCleanup = () => useContext(CleanupLauncher)

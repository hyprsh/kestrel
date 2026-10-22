import { useCallback, useState } from 'react'
import type { ThemeSwitcherValue } from '@hyprsh/design'

export type Theme = ThemeSwitcherValue

/** The key the choice is kept under; the rail's ThemeSwitcher and the pre-paint script in index.html use it too. */
export const THEME_KEY = 'kestrel.theme'
const order: Theme[] = ['system', 'light', 'dark']

function stored(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The theme choice, held here so the rail's ThemeSwitcher (which applies and saves it) and the
 * command menu's "Switch theme" action stay in step.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)
  const cycle = useCallback(() => setTheme((t) => order[(order.indexOf(t) + 1) % order.length]), [])
  return { theme, setTheme, cycle }
}

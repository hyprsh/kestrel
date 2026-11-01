// Upcoming's Display (Agenda or Month): a choice of this browser, kept in localStorage like the column widths and the theme,
// so it survives a reload and is not the household's. A phone has no Month.
import { Menu, MenuItem } from '@hyprsh/design'
import { useCallback, useState } from 'react'

export type DisplayMode = 'agenda' | 'month'
const KEY = 'kestrel.upcoming.display'
const displayLabel: Record<DisplayMode, string> = { agenda: 'Agenda', month: 'Month' }

function stored(): DisplayMode {
  try {
    return localStorage.getItem(KEY) === 'month' ? 'month' : 'agenda'
  } catch {
    return 'agenda'
  }
}

/** The display, and how to change it (and remember the change). */
export function useDisplayMode(): [DisplayMode, (mode: DisplayMode) => void] {
  const [mode, setMode] = useState<DisplayMode>(stored)
  const set = useCallback((next: DisplayMode) => {
    setMode(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // not remembered
    }
  }, [])
  return [mode, set]
}

/** The Display button beside Filter: the chosen display names it ("Agenda"), and its two rows are radio items. */
export function DisplayButton({ mode, onMode }: { mode: DisplayMode; onMode: (mode: DisplayMode) => void }) {
  return (
    <Menu.Container position="bottom-start">
      <Menu.Button variant="secondary" size="small" showChevron aria-label={`Display: ${displayLabel[mode]}`}>
        {displayLabel[mode]}
      </Menu.Button>
      <Menu width={180}>
        {(['agenda', 'month'] as const).map((m) => (
          <MenuItem key={m} role="radio" checked={mode === m} onSelect={() => onMode(m)}>
            {displayLabel[m]}
          </MenuItem>
        ))}
      </Menu>
    </Menu.Container>
  )
}

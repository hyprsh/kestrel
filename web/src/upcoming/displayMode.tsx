// Upcoming's Display (Agenda or Month). The household's "Upcoming starts on" is where it starts; this browser's own last choice, kept
// in localStorage like the column widths and the theme so it survives a reload, wins over it. A phone has no Month.
import { Menu, MenuItem } from '@hyprsh/design'
import { useCallback, useState } from 'react'
import { useDisplay } from '../display/useDisplay'

export type DisplayMode = 'agenda' | 'month'
const KEY = 'kestrel.upcoming.display'
const displayLabel: Record<DisplayMode, string> = { agenda: 'Agenda', month: 'Month' }

/** This browser's own choice, or null when it never made one. */
function stored(): DisplayMode | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'month' || v === 'agenda' ? v : null
  } catch {
    return null
  }
}

/** The display (this browser's choice, else the household's default), and how to change it (and remember the change). */
export function useDisplayMode(): [DisplayMode, (mode: DisplayMode) => void] {
  const { display } = useDisplay()
  const [own, setOwn] = useState<DisplayMode | null>(stored)
  const set = useCallback((next: DisplayMode) => {
    setOwn(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // not remembered
    }
  }, [])
  return [own ?? display.upcoming_display, set]
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

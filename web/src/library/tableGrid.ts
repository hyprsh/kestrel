// The columns the season table's rows share (VersionTable.tsx): the head row, a season's cells and an episode's cells line up.
import type { CSSProperties } from 'react'

/** The most Versions a Title has (a library has at most four Slots). */
export const TRACKS = 4

/**
 * The grid of one row for a Title with `versions` Versions. A wide screen has the name column (taking what is left), one 104 px column per
 * Version and the 56 px column of the ⋯ menu; a phone has the name column, one 40 px column per Version and the 36 px
 * column of the ⋯ menu.
 */
export function gridOf(versions: number, phone: boolean): { className: string; style: CSSProperties } {
  const tracks = (px: number) => (versions > 0 ? ` repeat(${versions}, ${px}px)` : '')
  if (phone) return { className: 'grid items-center', style: { gridTemplateColumns: `minmax(0,1fr)${tracks(40)} 36px` } }
  return { className: 'grid items-stretch', style: { gridTemplateColumns: `minmax(0,1fr)${tracks(104)} 56px` } }
}

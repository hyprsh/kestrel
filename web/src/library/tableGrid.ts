// The columns the season table's rows share (VersionTable.tsx): the head row, a season's cells and an episode's cells line up.
import type { CSSProperties } from 'react'

/** The most Versions a Title has (a library has at most four Slots). */
export const TRACKS = 4

/**
 * The grid of one row for a Title with `versions` Versions. A wide screen has the 220 px name column, one 104 px column per Version and
 * the actions column (at least 104 px, taking what is left); a phone has the name column, one 40 px column per Version and the 36 px
 * column of the ⋯ menu.
 */
export function gridOf(versions: number, phone: boolean): { className: string; style: CSSProperties } {
  if (phone) return { className: 'grid items-center', style: { gridTemplateColumns: `minmax(0,1fr) repeat(${versions}, 40px) 36px` } }
  return { className: 'grid items-stretch', style: { gridTemplateColumns: `220px repeat(${versions}, 104px) minmax(104px,1fr)` } }
}

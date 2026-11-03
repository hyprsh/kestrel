// The columns the season table's rows share (VersionTable.tsx): the head's Version cards, a season's cells and an episode's cells line up.
import type { CSSProperties } from 'react'

/** The Version columns of a wide screen's table: a Title has at most four Versions (a library has at most four Slots). */
export const TRACKS = 4

/**
 * The grid of one row for a Title with `versions` Versions. A wide screen has the name column, four equal Version columns (the ones
 * a Title has no Version for stay empty, the first of them holding Add Version) and the actions column; a phone has the name column,
 * one 40 px column per Version and the 36 px column of the ⋯ menu.
 */
export function gridOf(versions: number, phone: boolean): { className: string; style: CSSProperties } {
  if (phone) return { className: 'grid items-center', style: { gridTemplateColumns: `minmax(0,1fr) repeat(${versions}, 40px) 36px` } }
  return { className: 'grid items-stretch', style: { gridTemplateColumns: `220px repeat(${Math.max(TRACKS, versions)}, minmax(0,1fr)) 104px` } }
}

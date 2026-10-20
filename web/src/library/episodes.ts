// How episodes and seasons read in the UI, and the types the episode grid's
// actions (EpisodeActions.tsx, DeleteFiles.tsx) share.
import type { Episode } from '../api/queries'
import type { SlotKey } from './bits'

const two = (n: number) => String(n).padStart(2, '0')

/** "S01E03": how an episode reads in a scope label or the Log. */
export const episodeCode = (e: Episode) => `S${two(e.season)}E${two(e.number)}`

/** "Specials" or "Season 2". */
export const seasonName = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/** One of the Series' Versions as the episode grid's actions see it. */
export type EpisodeVersion = { id: number; slot: SlotKey; profileName: string }

/** What the last Search now or deletion said, above the grid. */
export type ActionStatus = { text: string; error: boolean } | null

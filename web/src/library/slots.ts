// The Slots of a Title as the page sees them: a list taken from its Versions, never a fixed pair, so a Title with
// more Slots (#282) only has to supply more. A Slot is a key (the API's), its name and a short label for a chip.
import type { Episode, TitleDetail } from '../api/queries'
import { slotLabel, slotKeys, type SlotKey } from './bits'

export type SlotInfo = { key: string; name: string; short: string }

const shortOf: Record<string, string> = { standard: 'STD', '4k': '4K' }

/** "german" as "German". */
const capitalised = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

/** A Slot's display name: Standard and 4K are known, any other key reads as itself, capitalised. */
export const slotName = (key: string): string => slotLabel[key as SlotKey] ?? capitalised(key)

/** A Slot's short label for a chip: STD, 4K, else the name in capitals, cut at six letters. */
export const slotShort = (key: string): string => shortOf[key] ?? slotName(key).toUpperCase().slice(0, 6)

const slotInfo = (key: string): SlotInfo => ({ key, name: slotName(key), short: slotShort(key) })

/** The Slots of a Title, in the order its Versions come (Standard and 4K first when it has them). */
export function slotsOf(title: Pick<TitleDetail, 'versions'>): SlotInfo[] {
  const keys = title.versions.map((v) => v.slot as string)
  const known = slotKeys.filter((k) => keys.includes(k))
  return [...known, ...keys.filter((k) => !(known as string[]).includes(k))].map(slotInfo)
}

type Cell = NonNullable<Episode['cells'][SlotKey]>

/** An episode's cell in a Slot (null: the Title has no Version there). */
export const cellOf = (e: Pick<Episode, 'cells'>, key: string): Cell | null => (e.cells as Record<string, Cell | null | undefined>)[key] ?? null

/**
 * The state of an episode across all its Slots as one square: `filled` (every Slot has it), `partial` (some Slots have
 * it, some Wanted), `wanted` (all Wanted), `downloading` (any Slot is downloading), `unreleased` (not aired) or
 * `unmonitored`.
 */
export type Combined = 'filled' | 'partial' | 'wanted' | 'downloading' | 'unreleased' | 'unmonitored'

export function combinedState(e: Pick<Episode, 'cells' | 'monitored'>, keys: readonly string[]): Combined {
  const states = keys.flatMap((k) => {
    const c = cellOf(e, k)
    return c ? [c.state as string] : []
  })
  const live = states.filter((s) => s !== 'unmonitored')
  if (live.length === 0) return 'unmonitored'
  if (live.includes('downloading')) return 'downloading'
  const have = live.filter((s) => s === 'filled').length
  const wanted = live.filter((s) => s === 'wanted').length
  if (wanted > 0) return have > 0 ? 'partial' : 'wanted'
  if (live.every((s) => s === 'unreleased')) return 'unreleased'
  return 'filled'
}

// The Slots of the library as the screens see them: the stored records, in the admin's order, with their labels (ADR 0024).
// A Title's page takes its Slots from its Versions, in that order. No Slot is special: nothing here knows an id.
import { useMemo } from 'react'
import type { Episode, TitleDetail } from '../api/queries'
import { useSlots, type Slot } from '../api/slots'

export type SlotInfo = { key: string; name: string; short: string }

/** "german" as "German". */
const capitalised = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

/**
 * A chip's short text for a label: "Standard" keeps STD, any other label of four characters or fewer shows in full, and
 * a longer one gives its first `n` letters. It reads the label, never the id: a Slot of any id can carry the label.
 */
const shorten = (label: string, n: number): string => {
  const letters = label.replace(/\s+/g, '')
  if (letters.toLowerCase() === 'standard') return 'STD'
  return (letters.length <= 4 ? letters : letters.slice(0, n)).toUpperCase()
}

/**
 * The library's Slots as a component uses them. A Slot with no record (a Version's Slot while the list loads) reads as
 * its id, capitalised.
 */
export type SlotNames = {
  /** The records, in Slot order. */
  list: readonly Slot[]
  /** The Slot's label. */
  name: (key: string) => string
  /** The Slot's short label for a chip: its label when it is four characters or fewer (STD for Standard), else its first three letters (more where two Slots would read alike). */
  short: (key: string) => string
  /** `keys` in Slot order; a key that is no Slot goes last. */
  order: <T extends string>(keys: readonly T[]) => T[]
  /** Whether Slot chrome says something: false only for a library of exactly one Slot, whose label it would repeat. */
  several: boolean
}

export function slotNamesOf(records: readonly Slot[] = []): SlotNames {
  const list = [...records].sort((a, b) => a.position - b.position)
  const label = (key: string) => list.find((r) => r.id === key)?.label ?? capitalised(key)
  const rank = (key: string) => {
    const i = list.findIndex((r) => r.id === key)
    return i < 0 ? list.length : i
  }
  const shorts = new Map<string, string>()
  for (let n = 3; n <= 6; n++) {
    const made = list.map((r) => shorten(r.label, n))
    if (new Set(made).size === made.length || n === 6) {
      list.forEach((r, i) => shorts.set(r.id, made[i]))
      break
    }
  }
  return {
    list,
    name: label,
    short: (key) => shorts.get(key) ?? shorten(label(key), 3),
    order: (keys) => [...keys].sort((a, b) => rank(a) - rank(b)),
    several: list.length !== 1, // until the list arrives a Slot's label is not known to be redundant
  }
}

/** The library's Slots for a component, refetched when they change so a rename reaches every label. */
export function useSlotNames(): SlotNames {
  const { data } = useSlots()
  return useMemo(() => slotNamesOf(data), [data])
}

/** The Slots of a Title in Slot order, taken from its Versions: a Slot with no Version in the Title has no place on its page. */
export function slotsOf(title: Pick<TitleDetail, 'versions'>, names: SlotNames): SlotInfo[] {
  return names.order(title.versions.map((v) => v.slot as string)).map((key) => ({ key, name: names.name(key), short: names.short(key) }))
}

/** The key of the Profile a Slot gives a new Title of `kind`, if it names one: its default, from the stored Slot record. */
export const slotDefault = (rec: Slot | undefined, kind: 'movie' | 'series'): string | undefined => (kind === 'series' ? rec?.default_series : rec?.default_movies) ?? undefined

type Cell = NonNullable<Episode['cells'][string]>

/** An episode's cell in a Slot (null: the Title has no Version there). */
export const cellOf = (e: Pick<Episode, 'cells'>, key: string): Cell | null => e.cells[key] ?? null

/**
 * The state of an episode across all its Slots as one square: `filled` (every Slot has it), `partial` (some Slots have
 * it, some Wanted), `wanted` (all Wanted), `long_missing` (Long Missing in any Slot and not downloading: it counts
 * here once, not also as Wanted), `downloading` (any Slot is downloading), `unreleased` (not aired) or `unmonitored`.
 */
export type Combined = 'filled' | 'partial' | 'wanted' | 'long_missing' | 'downloading' | 'unreleased' | 'unmonitored'

export function combinedState(e: Pick<Episode, 'cells' | 'monitored'>, keys: readonly string[]): Combined {
  const cells = keys.flatMap((k) => cellOf(e, k) ?? [])
  const states = cells.map((c) => c.state as string)
  const live = states.filter((s) => s !== 'unmonitored')
  if (live.length === 0) return 'unmonitored'
  if (live.includes('downloading')) return 'downloading'
  if (cells.some((c) => c.state === 'wanted' && c.long_missing)) return 'long_missing'
  const have = live.filter((s) => s === 'filled').length
  const wanted = live.filter((s) => s === 'wanted').length
  if (wanted > 0) return have > 0 ? 'partial' : 'wanted'
  if (live.every((s) => s === 'unreleased')) return 'unreleased'
  return 'filled'
}

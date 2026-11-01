// The Slot chips of a Library row: one per entry of the row's `slot_states`, in Slot order, each with the dot of its state
// and the Slot's short label ("STD", "4K 40%", "DE"); a Series' chip counts its episodes ("STD 56/62": have of aired). When no
// Title in the Library has more than one Slot the chips drop the Slot name and say the state alone ("Have", "40%").
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { percent } from '../format'
import { dotState, stateName } from '../ui/slotState'
import type { ChipData } from './SlotChip'
import { shownSlots } from './rowState'
import { slotShort } from './slots'

/** Whether every Title of the Library has at most one Slot, so a chip's Slot name says nothing. */
export const singleSlot = (rows: readonly Pick<TitleRow, 'slot_states'>[]) => rows.every((r) => r.slot_states.length <= 1)

export function rowChips(r: TitleRow, grabs: readonly QueueItem[], opts: { single?: boolean; profileName?: (key: string) => string } = {}): ChipData[] {
  return shownSlots(r, grabs).map((v) => {
    const state = dotState(v.state, v.long_missing)
    const grab = grabs.find((g) => g.slot === v.slot && !g.is_upgrade)
    const pct = v.state === 'downloading' && grab ? percent(grab.bytes_total, grab.bytes_left) : null
    const counted = v.episodes_aired != null && v.episodes_have != null && v.episodes_aired > 0 ? `${v.episodes_have}/${v.episodes_aired}` : null
    const word = state === 'downloading' ? (pct !== null ? `${stateName.downloading} ${pct}%` : stateName.downloading) : state ? stateName[state] : 'No Version'
    const detail = counted ? `${word} · ${v.episodes_have} of ${v.episodes_aired} aired episodes` : word
    const progress = pct !== null ? `${pct}%` : null
    const text = opts.single ? (counted ?? progress ?? (state === 'downloading' ? stateName.downloading : word)) : (counted ?? progress ?? undefined)
    return {
      key: v.slot,
      short: opts.single ? '' : slotShort(v.slot),
      state,
      text,
      tip: `${v.label}: ${detail}`,
      more: { name: v.label, profile: opts.profileName?.(v.profile), text: counted ?? progress ?? word },
    }
  })
}

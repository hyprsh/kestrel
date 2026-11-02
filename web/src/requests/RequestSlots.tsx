// A Request's Slots as chips, the chip alone ("STD", "4K") with its dot; where the Slot stands is in its tooltip and, said in
// words, in the row's second line (`requestStatus`).
import { useQueue } from '../api/queue'
import type { QueueItem } from '../api/queue'
import type { Request } from '../api/requests'
import { SlotChips } from '../library/SlotChip'
import { useSlotNames, type SlotNames } from '../library/slots'
import { stateName } from '../ui/slotState'
import { slotDot, slotState } from './status'

type Slots = Pick<Request, 'slots'>

export function RequestSlots({ request: r, live = true }: { request: Slots; live?: boolean }) {
  const queue = useQueue().data ?? []
  const slots = useSlotNames()
  const chips = r.slots.map((s) => {
    const st = slotState(s, live ? queue : [])
    const state = slotDot(s, st)
    return { key: s.slot, short: slots.several ? slots.short(s.slot) : '', state, tip: `${slots.name(s.slot)}: ${st.text || stateName[state]}` }
  })
  return <SlotChips chips={chips} max={4} wrap />
}

/** Where a Request's Slots stand, in words: "Searching", or "Standard: Completed · 4K: Searching" for several. */
export function requestStatus(r: Slots, queue: readonly QueueItem[], slots: SlotNames): string {
  return r.slots.map((s) => (r.slots.length > 1 ? `${slots.name(s.slot)}: ${slotState(s, [...queue]).text}` : slotState(s, [...queue]).text)).join(' · ')
}

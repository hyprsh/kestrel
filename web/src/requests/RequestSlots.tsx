// A Request's Slots as chips: the Slot's short label and where that Slot stands ("STD Searching", "4K Downloading 40%").
import { useQueue } from '../api/queue'
import type { Request } from '../api/requests'
import { SlotChips } from '../library/SlotChip'
import { slotName, slotShort } from '../library/slots'
import { stateName } from '../ui/slotState'
import { slotDot, slotState } from './status'

export function RequestSlots({ request: r, live = true }: { request: Pick<Request, 'slots' | 'title'>; live?: boolean }) {
  const queue = useQueue().data ?? []
  const chips = r.slots.map((s) => {
    const st = slotState(s, live ? queue : [])
    const state = slotDot(s, st)
    return { key: s.slot, short: slotShort(s.slot), state, text: st.text, tip: `${slotName(s.slot)}: ${st.text || stateName[state]}` }
  })
  return <SlotChips chips={chips} max={4} wrap />
}

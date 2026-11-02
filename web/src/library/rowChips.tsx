// The Slot chips of a Library row: one per entry of the row's `slot_states`, in Slot order, each with the dot of its state
// and the Slot's short label ("STD", "4K 40%", "DE"); a Series' chip counts its episodes ("STD 56/62": have of aired). When no
// Title in the Library has more than one Slot the chips drop the Slot name and say the state alone ("Have", "40%"). Each chip
// is the button of a popover that says what the Slot holds (see RowSlotPopover).
import type { TitleRow } from '../api/queries'
import type { QueueItem } from '../api/queue'
import { percent, plural } from '../format'
import { span, until } from '../time'
import { dotState, stateName, type SlotDotState } from '../ui/slotState'
import type { ChipData } from './SlotChip'
import { RowSlotPopover, type RowSlotInfo } from './RowSlotPopover'
import { shownSlots } from './rowState'
import type { SlotNames } from './slots'

type Entry = TitleRow['slot_states'][number]

/** Whether a chip's Slot name says nothing: the library has one Slot, or no Title of it has more than one Version. */
export const singleSlot = (rows: readonly Pick<TitleRow, 'slot_states'>[], slots?: SlotNames) => slots?.several === false || rows.every((r) => r.slot_states.length <= 1)

/** The state a Version is drawn in: Wanted and Long Missing as they are, a filled one with an Upgrade wanted as Upgrade wanted. */
function entryState(v: Pick<Entry, 'state' | 'long_missing' | 'upgrade_wanted'>): SlotDotState | null {
  return v.upgrade_wanted && v.state === 'filled' ? 'upgrade' : dotState(v.state, v.long_missing)
}

/** "12 days", "5 h": how long a Version has been Wanted. */
const wantedFor = (since: string, now: number) => {
  const hours = Math.max(0, Math.floor((now - Date.parse(since)) / 3_600_000))
  return hours < 24 ? `${hours} h` : plural(Math.floor(hours / 24), 'day')
}

/** What a Slot's popover says: the state in a line and the quiet lines beneath (the release, the episodes); a Movie's file the popover loads itself. */
function slotInfo(v: Entry, grab: QueueItem | undefined, profileName: string, now: number): RowSlotInfo {
  const state = entryState(v)
  const pct = state === 'downloading' && grab ? percent(grab.bytes_total, grab.bytes_left) : null
  const lines: string[] = []
  let text = state ? stateName[state] : 'No Version'
  if (state === 'downloading') {
    text = `${pct !== null ? `Downloading ${pct}%` : 'Downloading'}${grab?.eta ? ` · ${span(grab.eta * 1000)} left` : ''}`
    if (grab?.release_name) lines.push(grab.release_name)
  } else if (state === 'wanted' || state === 'long_missing') {
    text = `${state === 'long_missing' ? 'Long Missing' : 'Wanted'}${v.wanted_since ? ` ${wantedFor(v.wanted_since, now)}` : ''}${v.next_search_at ? ` · next search ${until(v.next_search_at, now)}` : ''}`
  } else if (state === 'upgrade') {
    text = 'Upgrade wanted'
  }
  if (v.episodes_aired != null && v.episodes_have != null) {
    lines.push(`${v.episodes_have} of ${plural(v.episodes_aired, 'aired episode')}${v.episodes_upgrade ? ` · ${v.episodes_upgrade} below cutoff` : ''}`)
  }
  return { heading: profileName === v.label ? v.label : `${v.label} · ${profileName}`, state, text, lines }
}

export function rowChips(
  r: TitleRow,
  grabs: readonly QueueItem[],
  opts: { single?: boolean; profileName?: (key: string) => string; slots?: SlotNames; now?: number; onOpen?: (slot: string) => void } = {},
): ChipData[] {
  const now = opts.now ?? Date.now()
  return shownSlots(r, grabs).map((v) => {
    const state = entryState(v)
    const grab = grabs.find((g) => g.slot === v.slot && !g.is_upgrade)
    const info = slotInfo(v, grab, opts.profileName?.(v.profile) ?? v.profile, now)
    const pct = v.state === 'downloading' && grab ? percent(grab.bytes_total, grab.bytes_left) : null
    const counted = v.episodes_aired != null && v.episodes_have != null && v.episodes_aired > 0 ? `${v.episodes_have}/${v.episodes_aired}` : null
    const word = state === 'downloading' ? (pct !== null ? `${stateName.downloading} ${pct}%` : stateName.downloading) : state ? stateName[state] : 'No Version'
    const detail = counted ? `${word} · ${v.episodes_have} of ${v.episodes_aired} aired episodes` : word
    const progress = pct !== null ? `${pct}%` : null
    const text = opts.single ? (counted ?? progress ?? (state === 'downloading' ? stateName.downloading : word)) : (counted ?? progress ?? undefined)
    const chip: ChipData = {
      key: v.slot,
      short: opts.single ? '' : (opts.slots?.short(v.slot) ?? v.label),
      state,
      text,
      tip: `${v.label}: ${detail}`,
      more: { name: v.label, profile: opts.profileName?.(v.profile), text: counted ?? progress ?? word },
      onOpen: opts.onOpen ? () => opts.onOpen!(v.slot) : undefined,
    }
    return opts.onOpen
      ? {
          ...chip,
          wrap: (trigger) => (
            <RowSlotPopover
              info={info}
              trigger={trigger}
              onOpen={() => opts.onOpen!(v.slot)}
              file={r.kind === 'movie' && v.state === 'filled' ? { titleId: r.id, versionId: v.version_id } : undefined}
            />
          ),
        }
      : chip
  })
}

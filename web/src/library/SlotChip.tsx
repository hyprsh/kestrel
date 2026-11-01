// chrome: domain-visual
// A Slot's state as a chip: the Slot's short label (STD, 4K, DE) with a dot coloured by its state, and the full state in
// its tooltip. The Series' episode rows, the Movie header and the phone's rows share it; a list longer than `max` ends in a
// "+N" chip that lists the rest in its tooltip. It takes any number of Slots. A chip with a `wrap` is a button: the wrap
// puts a popover on it with just that Slot (its file, its search, its download or its monitoring).
import { Button, Popover } from '@hyprsh/design'
import type { ReactElement } from 'react'
import { StateDot, stateName, dotState } from '../ui/slotState'
import { slotName, slotShort } from './slots'

export { StateDot }

export type ChipData = {
  key: string
  short: string
  state: string | null
  tip: string
  text?: string
  /** What the "+N" popover says of this Slot when it is folded in: its name, its Profile and its count or state. */
  more?: { name: string; profile?: string; text: string }
  /** Opens the Title at this Slot; the "+N" popover's row for the Slot is a button that calls it. */
  onOpen?: () => void
  /** Puts the Slot's popover on the chip's button; without it the chip is plain text. */
  wrap?: (trigger: ReactElement) => ReactElement
}

/** One chip. `text` follows the label ("40%", "Wanted"). */
function SlotChip({ chip, tabIndex }: { chip: ChipData; tabIndex?: number }) {
  const body = (
    <span className="inline-flex items-center gap-1.5">
      {chip.short && <span>{chip.short}</span>}
      {chip.text && <span className="text-gray-900">{chip.text}</span>}
    </span>
  )
  if (!chip.wrap)
    return (
      <span
        title={chip.tip}
        role="img"
        aria-label={chip.tip}
        data-slot={chip.key}
        data-state={chip.state ?? 'none'}
        className="label-12 inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-2 whitespace-nowrap"
      >
        <StateDot state={chip.state} />
        {body}
      </span>
    )
  return chip.wrap(
    <Button
      variant="tertiary"
      size="tiny"
      shape="rounded"
      title={chip.tip}
      aria-label={chip.tip}
      tabIndex={tabIndex}
      data-slot={chip.key}
      data-state={chip.state ?? 'none'}
      prefix={<StateDot state={chip.state} />}
      className="label-12 shrink-0 bg-gray-100 whitespace-nowrap"
    >
      {body}
    </Button>,
  )
}

/** "+N": a button whose popover lists the folded Slots, a line each (dot, name, Profile, count or state). */
function More({ rest }: { rest: ChipData[] }) {
  const trigger = (
    <Button
      variant="tertiary"
      size="tiny"
      shape="rounded"
      title={rest.map((c) => c.tip).join('\n')}
      aria-label={`${rest.length} more Slots`}
      data-more=""
      className="label-12 shrink-0 bg-gray-100 whitespace-nowrap"
    >
      +{rest.length}
    </Button>
  )
  return (
    // Not the row's: a click here opens the list, not the Title.
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()} className="inline-flex">
      <Popover trigger={trigger} label={`${rest.length} more Slots`} position="bottom-end" width={280}>
        <div className="flex flex-col gap-2">
          <p className="label-12 font-semibold text-gray-900">{rest.length === 1 ? '1 more Slot' : `${rest.length} more Slots`}</p>
          {rest.map((c) => {
            const row = (
              <>
                <StateDot state={c.state} />
                <span className="truncate text-left">
                  <b className="font-medium">{c.more?.name ?? c.short}</b> {c.more?.profile && <span className="text-gray-900">{c.more.profile}</span>}
                </span>
                <span className="tabular-nums">{c.more?.text ?? c.tip}</span>
              </>
            )
            const cls = 'label-13 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2'
            return c.onOpen ? (
              <button key={c.key} type="button" onClick={c.onOpen} className={`${cls} -mx-1.5 rounded-sm px-1.5 py-1 hover:bg-gray-alpha-100`}>
                {row}
              </button>
            ) : (
              <div key={c.key} className={cls}>
                {row}
              </div>
            )
          })}
        </div>
      </Popover>
    </span>
  )
}

/** The chips, with the ones past `max` folded into "+N" (its tooltip and popover list them). `tabIndex` -1 leaves the buttons to a grid's arrow keys. */
export function SlotChips({
  chips,
  max = 4,
  label,
  align = 'end',
  wrap = false,
  tabIndex,
}: {
  chips: ChipData[]
  max?: number
  label?: string
  align?: 'start' | 'end'
  wrap?: boolean
  tabIndex?: number
}) {
  const shown = chips.length > max ? chips.slice(0, max) : chips
  const rest = chips.length > max ? chips.slice(max) : []
  return (
    <span role={label ? 'group' : undefined} aria-label={label} className={`flex ${wrap ? 'flex-wrap' : ''} items-center gap-[5px] ${align === 'end' ? 'justify-end' : ''}`}>
      {shown.map((c) => (
        <SlotChip key={c.key} chip={c} tabIndex={tabIndex} />
      ))}
      {rest.length > 0 && <More rest={rest} />}
    </span>
  )
}

/** "Wanted 7 d" and so on: what a state is called in a tooltip. */
export const stateWord: Record<string, string> = { filled: 'Have', wanted: 'Wanted', downloading: 'Downloading', unreleased: 'Not aired', unmonitored: 'Not monitored' }

/**
 * One Slot's chip outside a list of them (a Grab, a Request, an entry of the Overview): the Slot's short label, `text` after it
 * ("40%"), and a dot in `state`. Its tooltip reads "Standard: Have". `longMissing` draws a Wanted Slot as Long Missing.
 */
export function SlotTag({ slot, state, longMissing = false, text, tip }: { slot: string; state: string | null; longMissing?: boolean; text?: string; tip?: string }) {
  const dot = dotState(state, longMissing)
  const name = slotName(slot)
  return <SlotChip chip={{ key: slot, short: slotShort(slot), state: dot, text, tip: tip ?? `${name}: ${dot ? stateName[dot] : 'no Version'}${text ? ` ${text}` : ''}` }} />
}

// chrome: domain-visual
// A Slot's state as a chip: the Slot's short label (STD, 4K, DE) with a dot coloured by its state, and the full state in
// its tooltip. The Series' episode rows, the Movie header and the phone's rows share it; a list longer than `max` ends in a
// "+N" chip that lists the rest in its tooltip. It takes any number of Slots. A chip with a `wrap` is a button: the wrap
// puts a popover on it with just that Slot (its file, its search, its download or its monitoring).
import { Button } from '@hyprsh/design'
import type { ReactElement } from 'react'

/** A state as the chip's dot draws it: green fills, amber is a hollow ring, blue is moving, gray rings are off. */
const dots: Record<string, string> = {
  filled: 'bg-green-700',
  wanted: 'shadow-[inset_0_0_0_2px_var(--amber-700)]',
  downloading: 'bg-blue-700',
  unreleased: 'bg-gray-300',
  unmonitored: 'shadow-[inset_0_0_0_1px_var(--gray-alpha-500)]',
  none: 'opacity-40 shadow-[inset_0_0_0_1px_var(--gray-alpha-500)]',
}

export function StateDot({ state, className = '' }: { state: string | null; className?: string }) {
  return <span aria-hidden data-state={state ?? 'none'} className={`inline-block size-2 shrink-0 rounded-full ${dots[state ?? 'none'] ?? dots.unmonitored} ${className}`} />
}

export type ChipData = {
  key: string
  short: string
  state: string | null
  tip: string
  text?: string
  /** Puts the Slot's popover on the chip's button; without it the chip is plain text. */
  wrap?: (trigger: ReactElement) => ReactElement
}

/** One chip. `text` follows the label ("40%", "Wanted"). */
function SlotChip({ chip, tabIndex }: { chip: ChipData; tabIndex?: number }) {
  const body = (
    <span className="inline-flex items-center gap-1.5">
      <span>{chip.short}</span>
      {chip.text && <span className="text-gray-900">{chip.text}</span>}
    </span>
  )
  if (!chip.wrap)
    return (
      <span
        title={chip.tip}
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

/** The chips, with the ones past `max` folded into "+N" (its tooltip lists them as the chips' own tooltips do). `tabIndex` -1 leaves the buttons to a grid's arrow keys. */
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
      {rest.length > 0 && (
        <span title={rest.map((c) => c.tip).join('\n')} data-more="" className="label-12 inline-flex h-[22px] shrink-0 items-center rounded-full bg-gray-100 px-2 whitespace-nowrap">
          +{rest.length}
        </span>
      )}
    </span>
  )
}

/** "Wanted 7 d" and so on: what a state is called in a tooltip. */
export const stateWord: Record<string, string> = { filled: 'Have', wanted: 'Wanted', downloading: 'Downloading', unreleased: 'Not aired', unmonitored: 'Not monitored' }

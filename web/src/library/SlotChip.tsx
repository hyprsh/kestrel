// chrome: domain-visual
// A Slot's state as a chip: the Slot's short label (STD, 4K, DE) with a dot coloured by its state, and the full state in
// its tooltip. The Series' episode rows, the Movie header and the phone's rows share it; a list longer than `max` ends in a
// "+N" chip that lists the rest in its tooltip. It takes any number of Slots.

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

export type ChipData = { key: string; short: string; state: string | null; tip: string; text?: string }

/** One chip. `text` follows the label ("40%", "Wanted"). */
function SlotChip({ chip }: { chip: ChipData }) {
  return (
    <span
      title={chip.tip}
      data-slot={chip.key}
      data-state={chip.state ?? 'none'}
      className="label-12 inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-2 whitespace-nowrap"
    >
      <StateDot state={chip.state} />
      <span>{chip.short}</span>
      {chip.text && <span className="text-gray-900">{chip.text}</span>}
    </span>
  )
}

/** The chips, with the ones past `max` folded into "+N" (its tooltip lists them as the chips' own tooltips do). */
export function SlotChips({ chips, max = 4, label, align = 'end' }: { chips: ChipData[]; max?: number; label?: string; align?: 'start' | 'end' }) {
  const shown = chips.length > max ? chips.slice(0, max) : chips
  const rest = chips.length > max ? chips.slice(max) : []
  return (
    <span role={label ? 'group' : undefined} aria-label={label} className={`flex flex-wrap items-center gap-[5px] ${align === 'end' ? 'justify-end' : ''}`}>
      {shown.map((c) => (
        <SlotChip key={c.key} chip={c} />
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

// chrome: domain-visual
// One state language for a Slot, the same on every screen: seven states, each a dot, and the legend that names them. The
// Slot chip, the Upcoming agenda and Month grid, and the popovers all draw their dots here.

/** The seven states: Have, Downloading, Wanted, Long Missing, Not out yet, Upgrade wanted, Not monitored. */
export type SlotDotState = 'filled' | 'downloading' | 'wanted' | 'long_missing' | 'unreleased' | 'upgrade' | 'unmonitored'

const dots: Record<SlotDotState | 'none', string> = {
  filled: 'bg-green-700',
  downloading: 'bg-blue-700',
  wanted: 'shadow-[inset_0_0_0_2px_var(--amber-700)]',
  long_missing: 'shadow-[inset_0_0_0_2px_var(--red-700)]',
  unreleased: 'bg-gray-400',
  upgrade: 'bg-green-700 shadow-[0_0_0_2px_var(--gray-100),0_0_0_3px_var(--amber-700)]',
  unmonitored: 'shadow-[inset_0_0_0_1px_var(--gray-alpha-500)]',
  none: 'opacity-40 shadow-[inset_0_0_0_1px_var(--gray-alpha-500)]',
}

/** The state a Version is drawn in: Long Missing is a Wanted one that has been so for long. */
export const dotState = (state: string | null, longMissing = false): SlotDotState | null => (state === null ? null : state === 'wanted' && longMissing ? 'long_missing' : state in dots ? (state as SlotDotState) : 'unmonitored')

/** The words of each state, as the legend and a tooltip say them. */
export const stateName: Record<SlotDotState, string> = {
  filled: 'Have',
  downloading: 'Downloading',
  wanted: 'Wanted',
  long_missing: 'Long Missing',
  unreleased: 'Not out yet',
  upgrade: 'Upgrade wanted',
  unmonitored: 'Not monitored',
}

/** The dot of a state (null: no Version). `className` replaces the size, `size-2`. */
export function StateDot({ state, className = 'size-2' }: { state: string | null; className?: string }) {
  return <span aria-hidden data-state={state ?? 'none'} className={`inline-block shrink-0 rounded-full ${dots[state && state in dots ? (state as SlotDotState) : state ? 'unmonitored' : 'none']} ${className}`} />
}

const legendOrder: SlotDotState[] = ['filled', 'downloading', 'wanted', 'long_missing', 'unreleased', 'upgrade', 'unmonitored']

/** The legend: the seven states with their dots. */
export function SlotLegend({ states = legendOrder, className = '' }: { states?: SlotDotState[]; className?: string }) {
  return (
    <ul aria-label="Legend" className={`label-12 flex flex-wrap gap-x-4 gap-y-1 text-gray-900 ${className}`}>
      {states.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <StateDot state={s} />
          {stateName[s]}
        </li>
      ))}
    </ul>
  )
}

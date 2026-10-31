import { Film, Tv } from 'lucide-react'
import { Badge, StatusDot, type BadgeProps } from '@hyprsh/design'
import { cx } from '../ui'

export type SlotKey = 'standard' | '4k'
export const slotKeys: SlotKey[] = ['standard', '4k']
export const slotLabel: Record<SlotKey, string> = { standard: 'Standard', '4k': '4K' }

/** Bytes on disk, in GB from 1 GB up, else in MB. */
export function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

type State = 'wanted' | 'filled' | 'downloading' | 'unmonitored' | 'unreleased' | string

type Variant = NonNullable<BadgeProps['variant']>

const stateText: Record<string, { variant: Variant; label: string }> = {
  wanted: { variant: 'amber', label: 'Wanted' },
  filled: { variant: 'green', label: 'Filled' },
  downloading: { variant: 'blue', label: 'Downloading' },
  unmonitored: { variant: 'gray', label: 'Unmonitored' },
  unreleased: { variant: 'gray', label: 'Unreleased' },
}

/** Badge variant, contrast and label for a Version's state; an unknown future state shows as itself. Spread the first two onto the Badge. */
export function versionStatus(state: State, longMissing = false): { variant: Variant; contrast: 'low'; label: string } {
  if (longMissing) return { variant: 'red', contrast: 'low', label: 'Long Missing' }
  const s = stateText[state] ?? { variant: 'gray', label: state }
  return { ...s, contrast: 'low' }
}

export function StatusBadge({ state, longMissing }: { state: State; longMissing?: boolean }) {
  const s = versionStatus(state, longMissing)
  return (
    <Badge variant={s.variant} contrast={s.contrast} size="sm">
      {s.label}
    </Badge>
  )
}

export type Dot = { state: 'success' | 'info' | 'warning' | 'error' | 'neutral'; variant?: 'outline' | 'dashed'; faint?: boolean }

/** The StatusDot of a Slot's Version (null: no Version in the Slot). */
export function dotOf(state: State | null, longMissing: boolean): Dot {
  if (state === null) return { state: 'neutral', faint: true } // no Version in the Slot: the quietest mark, so it never competes with Wanted
  if (longMissing) return { state: 'error', variant: 'outline' }
  switch (state) {
    case 'filled':
      return { state: 'success' }
    case 'downloading':
      return { state: 'info' }
    case 'wanted':
      return { state: 'warning', variant: 'outline' } // hollow: not there yet
    case 'unreleased':
      return { state: 'neutral', variant: 'dashed' }
    default:
      return { state: 'neutral' }
  }
}

function slotName(k: SlotKey, s: { state: string; long_missing: boolean } | null): string {
  return `${slotLabel[k]}: ${s ? versionStatus(s.state, s.long_missing).label : 'no Version'}`
}

/** The faint dot of a Slot with no Version is dimmed with this class. */
export const faintDot = 'opacity-40'

/** One dot per Slot: filled green when there is a file, hollow amber while Wanted, red when Long Missing, a faint dot with no Version. The row is one image named for every Slot. */
export function SlotDots({ slots }: { slots: Record<SlotKey, { state: string; long_missing: boolean } | null> }) {
  const name = slotKeys.map((k) => slotName(k, slots[k])).join(', ')
  return (
    <span role="img" aria-label={name} className="flex items-center gap-1">
      {slotKeys.map((k) => {
        const s = slots[k]
        const dot = dotOf(s ? s.state : null, !!s?.long_missing)
        // StatusDot always sets a hover title, so give it the Slot's own words; aria-hidden keeps it out of the accessibility tree.
        return <StatusDot key={k} title={slotName(k, s)} state={dot.state} variant={dot.variant} label={false} aria-hidden className={dot.faint ? faintDot : undefined} />
      })}
    </span>
  )
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === 'series' ? <Tv className={cx('size-3.5', className)} /> : <Film className={cx('size-3.5', className)} />
}

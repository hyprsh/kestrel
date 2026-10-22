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
  wanted: { variant: 'amber-subtle', label: 'Wanted' },
  filled: { variant: 'green-subtle', label: 'Filled' },
  downloading: { variant: 'blue-subtle', label: 'Downloading' },
  unmonitored: { variant: 'gray-subtle', label: 'Unmonitored' },
  unreleased: { variant: 'gray-subtle', label: 'Unreleased' },
}

/** Badge variant and label for a Version's state; an unknown future state shows as itself. */
export function versionStatus(state: State, longMissing = false): { variant: Variant; label: string } {
  if (longMissing) return { variant: 'red-subtle', label: 'Long Missing' }
  return stateText[state] ?? { variant: 'gray-subtle', label: state }
}

export function StatusBadge({ state, longMissing }: { state: State; longMissing?: boolean }) {
  const s = versionStatus(state, longMissing)
  return (
    <Badge variant={s.variant} size="sm">
      {s.label}
    </Badge>
  )
}

type Dot = { state: 'success' | 'info' | 'warning' | 'error' | 'neutral'; variant?: 'outline' | 'dashed' }

function dotOf(state: State | null, longMissing: boolean): Dot {
  if (state === null) return { state: 'neutral', variant: 'outline' } // no Version in the Slot
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

/** One dot per Slot: filled green when there is a file, hollow amber while Wanted, red when Long Missing. */
export function SlotDots({ slots }: { slots: Record<SlotKey, { state: string; long_missing: boolean } | null> }) {
  return (
    <span className="flex items-center gap-1">
      {slotKeys.map((k) => {
        const s = slots[k]
        const dot = dotOf(s ? s.state : null, !!s?.long_missing)
        return (
          <StatusDot
            key={k}
            state={dot.state}
            variant={dot.variant}
            label={false}
            title={`${slotLabel[k]}: ${s ? versionStatus(s.state, s.long_missing).label : 'no Version'}`}
          />
        )
      })}
    </span>
  )
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === 'series' ? <Tv className={cx('size-3.5', className)} /> : <Film className={cx('size-3.5', className)} />
}

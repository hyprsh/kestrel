import { Film, Tv } from 'lucide-react'
import { Badge, cx, type Tone } from '../ui'

export type SlotKey = 'standard' | '4k'
export const slotKeys: SlotKey[] = ['standard', '4k']
export const slotLabel: Record<SlotKey, string> = { standard: 'Standard', '4k': '4K' }

/** Bytes on disk, in GB from 1 GB up, else in MB. */
export function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

type State = 'wanted' | 'filled' | 'downloading' | 'unmonitored' | 'unreleased' | string

const stateText: Record<string, { tone: Tone; label: string }> = {
  wanted: { tone: 'amber', label: 'Wanted' },
  filled: { tone: 'green', label: 'Filled' },
  downloading: { tone: 'blue', label: 'Downloading' },
  unmonitored: { tone: 'gray', label: 'Unmonitored' },
  unreleased: { tone: 'gray', label: 'Unreleased' },
}

/** Tone and label for a Version's state; an unknown future state shows as itself. */
export function versionStatus(state: State, longMissing = false): { tone: Tone; label: string } {
  if (longMissing) return { tone: 'red', label: 'Long Missing' }
  return stateText[state] ?? { tone: 'gray', label: state }
}

export function StatusBadge({ state, longMissing }: { state: State; longMissing?: boolean }) {
  const s = versionStatus(state, longMissing)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

function dotClass(state: State | null, longMissing: boolean): string {
  if (state === null) return 'border border-gray-alpha-400'
  if (longMissing) return 'border-2 border-red-700'
  switch (state) {
    case 'filled':
      return 'bg-green-700'
    case 'downloading':
      return 'bg-blue-700 animate-pulse'
    case 'wanted':
      return 'border-2 border-amber-700' // hollow: not there yet
    case 'unreleased':
      return 'border border-dashed border-gray-700'
    default:
      return 'bg-gray-600'
  }
}

/** One dot per Slot: filled green when there is a file, hollow amber while Wanted, red when Long Missing. */
export function SlotDots({ slots }: { slots: Record<SlotKey, { state: string; long_missing: boolean } | null> }) {
  return (
    <span className="flex items-center gap-1">
      {slotKeys.map((k) => {
        const s = slots[k]
        return (
          <span
            key={k}
            role="img"
            aria-label={`${slotLabel[k]}: ${s ? (s.long_missing ? 'long missing' : s.state) : 'no Version'}`}
            title={`${slotLabel[k]}: ${s ? versionStatus(s.state, s.long_missing).label : 'no Version'}`}
            className={cx('size-2 rounded-full', dotClass(s ? s.state : null, !!s?.long_missing))}
          />
        )
      })}
    </span>
  )
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === 'series' ? <Tv className={cx('size-3.5', className)} /> : <Film className={cx('size-3.5', className)} />
}

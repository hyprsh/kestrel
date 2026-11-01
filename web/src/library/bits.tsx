import { Film, Tv } from 'lucide-react'
import { cx } from '../ui'

export type SlotKey = 'standard' | '4k'
export const slotKeys: SlotKey[] = ['standard', '4k']
export const slotLabel: Record<SlotKey, string> = { standard: 'Standard', '4k': '4K' }

/** The plain words for each Manual search column's two directions, as the Sort menu and Settings > Display name them. */
export const manualSearchSortLabels: Record<'score' | 'release' | 'quality' | 'languages' | 'formats' | 'size' | 'age' | 'indexer', { asc: string; desc: string }> = {
  score: { asc: 'Worst first', desc: 'Best first' },
  release: { asc: 'Release A to Z', desc: 'Release Z to A' },
  quality: { asc: 'Quality A to Z', desc: 'Quality Z to A' },
  languages: { asc: 'Languages A to Z', desc: 'Languages Z to A' },
  formats: { asc: 'Custom formats: fewest points first', desc: 'Custom formats: most points first' },
  size: { asc: 'Smallest first', desc: 'Largest first' },
  age: { asc: 'Newest first', desc: 'Oldest first' },
  indexer: { asc: 'Indexer A to Z', desc: 'Indexer Z to A' },
}

/** Bytes on disk, in GB from 1 GB up, else in MB. */
export function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

type State = 'wanted' | 'filled' | 'downloading' | 'unmonitored' | 'unreleased' | string

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

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === 'series' ? <Tv className={cx('size-3.5', className)} /> : <Film className={cx('size-3.5', className)} />
}

// The status line in a Title's header, one entry per Slot: a Movie's state badge, a Series' row of label, progress bar and counts.
import type { ReactNode } from 'react'
import { Badge, Progress } from '@hyprsh/design'
import type { TitleDetail } from '../api/queries'
import { slotKeys, slotLabel, versionStatus, type SlotKey } from './bits'

type Version = TitleDetail['versions'][number]

/** The fill of a Series Slot's bar: red when something is Long Missing, amber while Wanted, accent while downloading, else green. */
function fill(v: Version): string {
  if (v.long_missing || (v.coverage?.long_missing ?? 0) > 0) return 'var(--red-700)'
  if (v.state === 'wanted' || (v.coverage?.wanted ?? 0) > 0) return 'var(--amber-700)'
  if (v.state === 'downloading') return 'var(--accent-700)'
  return 'var(--green-700)'
}

/** A Movie's Slot without a Version: muted text, not a pill that looks like a button. */
function MovieNotKept({ slot }: { slot: SlotKey }) {
  return <span className="label-12 text-gray-900">{slotLabel[slot]} · Not kept</span>
}

/** The row every Series Slot shares: mono Slot label, bar track, counts. */
function SlotRow({ slot, children }: { slot: SlotKey; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="label-12-mono w-14 shrink-0 text-gray-900">{slotLabel[slot]}</span>
      {children}
    </div>
  )
}

function SeriesNotKept({ slot }: { slot: SlotKey }) {
  return (
    <SlotRow slot={slot}>
      <div data-testid="empty-track" aria-hidden className="h-1.5 w-36 shrink-0 rounded-full bg-gray-200" />
      <span className="label-12 text-gray-900">Not kept</span>
    </SlotRow>
  )
}

function MovieSlot({ slot, version: v }: { slot: SlotKey; version: Version }) {
  const s = versionStatus(v.state, v.long_missing)
  return (
    <Badge variant={s.variant} contrast={s.contrast} size="sm">
      {slotLabel[slot]} · {s.label}
    </Badge>
  )
}

function SeriesSlot({ slot, version: v }: { slot: SlotKey; version: Version }) {
  const c = v.coverage
  // "of N" counts every released episode, monitored or not.
  const released = c ? c.filled + c.wanted + c.unmonitored : 0
  const notMonitored = c && c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null
  const counts = c
    ? [`${c.filled} of ${released}`, notMonitored, c.wanted > 0 ? `${c.wanted} Wanted` : null, c.long_missing > 0 ? `${c.long_missing} Long Missing` : null].filter(Boolean).join(' · ')
    : versionStatus(v.state, v.long_missing).label
  return (
    <SlotRow slot={slot}>
      <div className="w-36 shrink-0">
        <Progress
          value={c?.filled ?? 0}
          max={Math.max(released, 1)}
          colors={{ 0: fill(v) }}
          height={6}
          aria-label={`${slotLabel[slot]}: ${c ? `${c.filled} of ${released} episodes${notMonitored ? `, ${notMonitored}` : ''}` : versionStatus(v.state, v.long_missing).label}`}
        />
      </div>
      <span className="label-12 text-gray-900">{counts}</span>
    </SlotRow>
  )
}

/** One entry per Slot, so the header says how complete the Title is without opening a Version. */
export function TitleStatus({ title }: { title: TitleDetail }) {
  const series = title.kind === 'series'
  return (
    <ul aria-label="Status" className={series ? 'mt-2 flex flex-col gap-1.5' : 'mt-2 flex flex-wrap gap-2'}>
      {slotKeys.map((k) => {
        const v = title.versions.find((x) => x.slot === k)
        return <li key={k}>{series ? v ? <SeriesSlot slot={k} version={v} /> : <SeriesNotKept slot={k} /> : v ? <MovieSlot slot={k} version={v} /> : <MovieNotKept slot={k} />}</li>
      })}
    </ul>
  )
}

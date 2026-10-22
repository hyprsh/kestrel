// The status line in a Title's header, one entry per Slot: a Movie's state badge, a Series' progress bar.
import { Badge, Progress } from '@hyprsh/design'
import type { TitleDetail } from '../api/queries'
import { slotKeys, slotLabel, versionStatus, type SlotKey } from './bits'

type Version = TitleDetail['versions'][number]

/** The fill of a Series Slot's bar: red when something is Long Missing, amber while Wanted, blue while downloading, else green. */
function fill(v: Version): string {
  if (v.long_missing || (v.coverage?.long_missing ?? 0) > 0) return 'var(--red-700)'
  if (v.state === 'wanted' || (v.coverage?.wanted ?? 0) > 0) return 'var(--amber-700)'
  if (v.state === 'downloading') return 'var(--blue-700)'
  return 'var(--green-700)'
}

function NotKept({ slot }: { slot: SlotKey }) {
  return (
    <Badge variant="gray-subtle" size="sm">
      {slotLabel[slot]} · Not kept
    </Badge>
  )
}

function SeriesSlot({ slot, version: v }: { slot: SlotKey; version: Version }) {
  const c = v.coverage
  const counts = c
    ? [`${c.filled} of ${c.episodes}`, c.wanted > 0 ? `${c.wanted} Wanted` : null, c.long_missing > 0 ? `${c.long_missing} Long Missing` : null].filter(Boolean).join(' · ')
    : versionStatus(v.state, v.long_missing).label
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="label-12-mono w-14 shrink-0 text-gray-900">{slotLabel[slot]}</span>
      <div className="w-36 shrink-0">
        <Progress
          value={c?.filled ?? 0}
          max={Math.max(c?.episodes ?? 1, 1)}
          colors={{ 0: fill(v) }}
          height={6}
          aria-label={`${slotLabel[slot]}: ${c ? `${c.filled} of ${c.episodes} episodes` : versionStatus(v.state, v.long_missing).label}`}
        />
      </div>
      <span className="label-12 text-gray-900">{counts}</span>
    </div>
  )
}

/** One entry per Slot, so the header says how complete the Title is without opening a Version. */
export function TitleStatus({ title }: { title: TitleDetail }) {
  const series = title.kind === 'series'
  return (
    <ul aria-label="Status" className={series ? 'mt-2 flex flex-col gap-1.5' : 'mt-2 flex flex-wrap gap-2'}>
      {slotKeys.map((k) => {
        const v = title.versions.find((x) => x.slot === k)
        return (
          <li key={k}>
            {!v ? (
              <NotKept slot={k} />
            ) : series ? (
              <SeriesSlot slot={k} version={v} />
            ) : (
              <Badge variant={versionStatus(v.state, v.long_missing).variant} size="sm">
                {slotLabel[k]} · {versionStatus(v.state, v.long_missing).label}
              </Badge>
            )}
          </li>
        )
      })}
    </ul>
  )
}

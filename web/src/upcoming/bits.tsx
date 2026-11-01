// The state badges of a Title with no date yet, and the markers of an episode.
import { Badge, Button, Progress } from '@hyprsh/design'
import { Check } from 'lucide-react'
import type { QueueItem } from '../api/queue'
import type { UpcomingItem, UpcomingSlot } from '../api/upcoming'
import { percent } from '../format'
import { phases } from '../grabs/phase'
import { slotLabel, type SlotKey } from '../library/bits'
import { resolutionOf, standing, wantedFor, type Standing } from './state'

const markerLabel = { series_premiere: 'Series premiere', season_premiere: 'Season premiere', season_finale: 'Season finale', special: 'Special' } as const

const slotName = (slot: string) => slotLabel[slot as SlotKey] ?? slot

/** One Version's state as a badge, with a download's live progress beside it. */
function StandingBadge({ slot, st, prefix, now }: { slot: UpcomingSlot; st: Standing; prefix: boolean; now: number }) {
  const lead = prefix ? `${slotName(slot.slot)} · ` : ''
  switch (st.kind) {
    case 'imported': {
      const quality = st.quality ? `${resolutionOf(st.quality)} · ${slotName(slot.slot)}` : slotName(slot.slot)
      return (
        <Badge variant="green" contrast="low" size="sm" icon={<Check />}>
          {quality}
        </Badge>
      )
    }
    case 'grabbed': {
      const g = st.grab
      const pct = g.phase === 'importing' ? 100 : percent(g.bytes_total, g.bytes_left)
      return (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="blue" contrast="low" size="sm">
            {lead}
            {phases[g.phase].label}
            {pct !== null && g.phase === 'downloading' ? ` ${pct}%` : ''}
          </Badge>
          {pct !== null && <Progress value={pct} type="success" height={4} width={48} aria-label={`${g.release_name} progress`} />}
        </span>
      )
    }
    case 'wanted': {
      const how = st.since ? ` ${wantedFor(st.since, now)}` : ''
      return (
        <Badge variant={st.long ? 'red' : 'amber'} contrast="low" size="sm">
          {lead}
          {st.long ? 'Long missing' : 'Wanted'}
          {how}
        </Badge>
      )
    }
    default:
      return (
        <Badge variant="gray" contrast="low" size="sm">
          {lead}Not out yet
        </Badge>
      )
  }
}

/** The same badges for a Title that is not an entry (a Title with no date yet). */
export function Standings({
  title,
  slots,
  queue,
  now,
  onSearch,
}: {
  title: Pick<UpcomingItem, 'kind' | 'title_id' | 'season' | 'episode'>
  slots: UpcomingSlot[]
  queue: readonly QueueItem[]
  now: number
  onSearch?: (slots: UpcomingSlot[]) => void
}) {
  const all = slots.map((slot) => ({ slot, st: standing(title, slot, queue) }))
  if (all.length > 0 && all.every((x) => x.st.kind === 'not_out')) {
    return (
      <Badge variant="gray" contrast="low" size="sm">
        Not out yet
      </Badge>
    )
  }
  const wanted = all.filter((x) => x.st.kind === 'wanted').map((x) => x.slot)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {all.map(({ slot, st }) => (
        <StandingBadge key={slot.slot} slot={slot} st={st} prefix={all.length > 1} now={now} />
      ))}
      {onSearch && wanted.length > 0 && (
        <Button
          variant="tertiary"
          size="tiny"
          onClick={(e) => {
            e.stopPropagation()
            onSearch(wanted)
          }}
        >
          Search now
        </Button>
      )}
    </span>
  )
}

/** Premiere, finale and Specials marks of an episode. */
export function Markers({ markers }: { markers: UpcomingItem['markers'] }) {
  return (
    <>
      {markers.map((m) => (
        <Badge key={m} variant={m === 'special' ? 'gray' : 'purple'} contrast="low" size="sm">
          {markerLabel[m] ?? m}
        </Badge>
      ))}
    </>
  )
}

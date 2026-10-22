// What Upcoming and the Overview's Coming section draw alike: the state badges of an entry and the
// markers, release badges and one-line summary of it.
import { Badge, Button, Progress } from '@hyprsh/design'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { QueueItem } from '../api/queue'
import type { UpcomingItem, UpcomingSlot } from '../api/upcoming'
import { percent } from '../format'
import { phases } from '../grabs/phase'
import { slotLabel, type SlotKey } from '../library/bits'
import { airTime, episodeCode, resolutionOf, standing, wantedFor, type Standing, type Tally } from './state'

const releaseLabel = { theatrical: 'In cinemas', digital: 'Digital', physical: 'Physical' } as const
const markerLabel = { series_premiere: 'Series premiere', season_premiere: 'Season premiere', season_finale: 'Season finale', special: 'Special' } as const

const slotName = (slot: string) => slotLabel[slot as SlotKey] ?? slot

/** "24 Oct" for a YYYY-MM-DD day. */
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** One Version's state as a badge, with a download's live progress beside it. */
function StandingBadge({ slot, st, prefix, now }: { slot: UpcomingSlot; st: Standing; prefix: boolean; now: number }) {
  const lead = prefix ? `${slotName(slot.slot)} · ` : ''
  switch (st.kind) {
    case 'imported': {
      const quality = st.quality ? `${resolutionOf(st.quality)} · ${slotName(slot.slot)}` : slotName(slot.slot)
      return (
        <Badge variant="green-subtle" size="sm" icon={<Check />}>
          {quality}
        </Badge>
      )
    }
    case 'grabbed': {
      const g = st.grab
      const pct = g.phase === 'importing' ? 100 : percent(g.bytes_total, g.bytes_left)
      return (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="blue-subtle" size="sm">
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
        <Badge variant={st.long ? 'red-subtle' : 'amber-subtle'} size="sm">
          {lead}
          {st.long ? 'Long missing' : 'Wanted'}
          {how}
        </Badge>
      )
    }
    default:
      return (
        <Badge variant="gray-subtle" size="sm">
          {lead}Not out yet
        </Badge>
      )
  }
}

/**
 * Where an entry stands in each Slot it has a Version in: Not out yet, Wanted for how long (red once
 * Long Missing), downloading with live progress off the queue, or Imported with its quality and Slot.
 * With two Slots each badge names its own.
 */
export function StateBadges({ item, queue, now, onSearch }: { item: UpcomingItem; queue: readonly QueueItem[]; now: number; onSearch?: (slots: UpcomingSlot[]) => void }) {
  return <Standings title={item} slots={item.slots} queue={queue} now={now} onSearch={onSearch} />
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
      <Badge variant="gray-subtle" size="sm">
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

/** A group's episodes added up, per Slot: "5 Imported", "3 Wanted 2 days", "1 Long missing". */
export function TallyBadges({ tallies, now }: { tallies: Tally[]; now: number }) {
  const prefix = tallies.length > 1
  const badges: ReactNode[] = []
  for (const t of tallies) {
    const lead = prefix ? `${slotName(t.slot)} · ` : ''
    if (t.imported) {
      badges.push(
        <Badge key={`${t.slot}-i`} variant="green-subtle" size="sm" icon={<Check />}>
          {lead}
          {t.imported} Imported
        </Badge>,
      )
    }
    if (t.grabbed) {
      badges.push(
        <Badge key={`${t.slot}-g`} variant="blue-subtle" size="sm">
          {lead}
          {t.grabbed} Downloading
        </Badge>,
      )
    }
    if (t.wanted - t.long > 0) {
      badges.push(
        <Badge key={`${t.slot}-w`} variant="amber-subtle" size="sm">
          {lead}
          {t.wanted - t.long} Wanted{t.since && t.long === 0 ? ` ${wantedFor(t.since, now)}` : ''}
        </Badge>,
      )
    }
    if (t.long) {
      badges.push(
        <Badge key={`${t.slot}-l`} variant="red-subtle" size="sm">
          {lead}
          {t.long} Long missing
        </Badge>,
      )
    }
    if (t.notOut) {
      badges.push(
        <Badge key={`${t.slot}-n`} variant="gray-subtle" size="sm">
          {lead}
          {t.notOut} Not out yet
        </Badge>,
      )
    }
  }
  return <span className="flex flex-wrap items-center gap-1.5">{badges}</span>
}

/** Premiere, finale and Specials marks of an episode. */
export function Markers({ markers }: { markers: UpcomingItem['markers'] }) {
  return (
    <>
      {markers.map((m) => (
        <Badge key={m} variant={m === 'special' ? 'gray-subtle' : 'purple-subtle'} size="sm">
          {markerLabel[m] ?? m}
        </Badge>
      ))}
    </>
  )
}

/** A Movie's release badge and, until it is out, when it becomes searchable; the release that makes it searchable says so. */
export function MovieNotes({ item }: { item: UpcomingItem }) {
  return (
    <>
      {item.release_type && (
        <Badge variant="blue-subtle" size="sm">
          {releaseLabel[item.release_type]}
        </Badge>
      )}
      {item.searchable && (
        <Badge variant="teal-subtle" size="sm" title="This release makes the Movie searchable">
          Searchable
        </Badge>
      )}
      {!item.released && <span className="label-12 text-gray-900">{item.searchable_from ? `searchable from ${shortDate(item.searchable_from)}` : 'no search date yet'}</span>}
    </>
  )
}

/** The Movie's other release dates: "in cinemas since 3 Oct, physical 12 Dec". */
export function otherDates(item: UpcomingItem, today: string): string {
  const names = { theatrical: 'in cinemas', digital: 'digital', physical: 'physical' } as const
  return item.dates
    .filter((d) => d.release_type !== item.release_type)
    .map((d) => `${names[d.release_type]} ${d.date <= today ? 'since ' : ''}${shortDate(d.date)}`)
    .join(', ')
}

/** "S02E04 · Episode name", or the Movie's year. */
export function EntryName({ item }: { item: UpcomingItem }) {
  if (item.kind === 'series') {
    return (
      <>
        <span className="font-medium">{item.title}</span> <span className="text-gray-900">{episodeCode(item.season!, item.episode!)}</span>
        {item.episode_name ? <span className="text-gray-900"> · {item.episode_name}</span> : null}
      </>
    )
  }
  return (
    <>
      <span className="font-medium">{item.title}</span>
      {item.year ? <span className="text-gray-900"> {item.year}</span> : null}
    </>
  )
}

/** The one-line form: name, notes and state badges. Overview's Coming section uses it. */
export function UpcomingLine({ item, queue, now }: { item: UpcomingItem; queue: readonly QueueItem[]; now: number }) {
  const at = airTime(item)
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate">
        <EntryName item={item} />
      </span>
      {item.kind === 'movie' ? <MovieNotes item={item} /> : <Markers markers={item.markers} />}
      {at && <span className="label-12 text-gray-900 tabular">{at}</span>}
      <span className="ml-auto">
        <StateBadges item={item} queue={queue} now={now} />
      </span>
    </span>
  )
}

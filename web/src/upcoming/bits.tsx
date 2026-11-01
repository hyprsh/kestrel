// The Slot chips of a Title with no date yet, and the markers of an episode.
import { Badge, Button } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import type { UpcomingItem, UpcomingSlot } from '../api/upcoming'
import { SlotChips } from '../library/SlotChip'
import { entryChips, standing } from './state'

const markerLabel = { series_premiere: 'Series premiere', season_premiere: 'Season premiere', season_finale: 'Season finale', special: 'Special' } as const

/** The Slot chips of a Title that is not an entry (a Title with no date yet), with Search now for the Wanted ones. */
export function Standings({
  title,
  slots,
  queue,
  onSearch,
}: {
  title: Pick<UpcomingItem, 'kind' | 'title_id' | 'season' | 'episode'>
  slots: UpcomingSlot[]
  queue: readonly QueueItem[]
  onSearch?: (slots: UpcomingSlot[]) => void
}) {
  const wanted = slots.filter((slot) => standing(title, slot, queue).kind === 'wanted')
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <SlotChips chips={entryChips({ ...title, slots, monitored: true }, queue)} max={4} wrap />
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

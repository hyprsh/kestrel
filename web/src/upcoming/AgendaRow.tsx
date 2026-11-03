// chrome: domain-visual
// One entry of the Agenda: the poster; the Title in bold with the episode's code and name; a line with when it airs, the
// network and its Slots; and, at the right, where it stands. A phone's row is narrower: the status under the name, the time at the right.
import { Button } from '@hyprsh/design'
import type { QueueItem } from '../api/queue'
import type { UpcomingItem, UpcomingSlot } from '../api/upcoming'
import { SlotPills } from '../library/SlotPills'
import { TitlePoster } from '../poster'
import { cx } from '../ui'
import { Markers } from './bits'
import { useSlotNames } from '../library/slots'
import { airTime, entryChips, episodeCode, movieWhen, releaseName, type EntryStatus } from './state'

type RowProps = {
  item: UpcomingItem
  queue: readonly QueueItem[]
  /** Where the entry stands, worked out once for this queue. */
  status: EntryStatus
  today: string
  now: number
  /** The j/k cursor is on this row. */
  current: boolean
  index: number
  onOpen: () => void
  onSearch: (slots: UpcomingSlot[]) => void
  compact: boolean
}

/** "Aired 03:00 · AMC", "21:00 · HBO": the time (said to be past once the air time is), then the network when the data has one. */
function whenLine(item: UpcomingItem, today: string, now: number): string {
  if (item.kind === 'movie') return movieWhen(item, today)
  const at = airTime(item)
  const aired = item.air_at !== null && Date.parse(item.air_at) <= now
  return [at ? `${aired ? 'Aired ' : ''}${at}` : null, item.network].filter(Boolean).join(' · ')
}

export function AgendaRow({ item, queue, status, today, now, current, index, onOpen, onSearch, compact }: RowProps) {
  const names = useSlotNames()
  const code = item.kind === 'series' ? episodeCode(item.season!, item.episode!) : null
  const what = item.kind === 'series' ? [code, item.episode_name].filter(Boolean).join(' · ') : item.release_type ? releaseName[item.release_type] : ''
  const when = whenLine(item, today, now)
  const chips = <SlotPills chips={entryChips(item, queue, names)} max={4} wrap label={`${item.title} Slots`} />
  const at = airTime(item)
  const name = (
    <>
      <b className="font-semibold">{item.title}</b> <span className="text-gray-900">{what}</span>
    </>
  )
  const base = 'relative border-b border-gray-alpha-200 last:border-b-0'
  const open = cx('absolute inset-0 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700', current && 'bg-gray-alpha-100')
  const openButton = <button type="button" data-nav={`up-${index}`} aria-current={current ? 'true' : undefined} aria-label={`${item.title} ${what}`.trim()} onClick={onOpen} className={open} />
  if (compact) {
    return (
      <li data-imported={status.kind === 'imported' || undefined} className={cx(base, 'flex items-center gap-3 px-4 py-2.5')}>
        {openButton}
        <TitlePoster id={item.title_id} hasPoster={item.has_poster} size="xs" />
        <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label-14 truncate">{name}</span>
          <span className="pointer-events-auto relative">{chips}</span>
        </div>
        {at && <span className="label-12 pointer-events-none tabular-nums text-gray-900">{at}</span>}
      </li>
    )
  }
  return (
    <li data-imported={status.kind === 'imported' || undefined} className={cx(base, 'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5')}>
      {openButton}
      <TitlePoster id={item.title_id} hasPoster={item.has_poster} size="sm" />
      <div className="pointer-events-none flex min-w-0 flex-col gap-1">
        <span className="label-14 truncate">{name}</span>
        <span className="label-12 flex flex-wrap items-center gap-1.5 text-gray-900">
          {when && <span>{when}</span>}
          <Markers markers={item.markers} />
        </span>
      </div>
      <div className="relative flex items-center gap-2">
        <span className="pointer-events-auto relative">{chips}</span>
        {status.wanted.length > 0 && status.kind === 'missing' && (
          <Button variant="tertiary" size="tiny" aria-label={`Search Now for ${item.title} ${what}`} onClick={() => onSearch(status.wanted)}>
            Search Now
          </Button>
        )}
      </div>
    </li>
  )
}

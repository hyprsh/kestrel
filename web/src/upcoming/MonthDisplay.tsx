// chrome: domain-visual
// Upcoming's Month display: the design MonthView (header, Monday-first grid, up to three entries a day and "+N more") fed with the
// entries as Kestrel states them. This only maps Kestrel's entries and statuses onto it, and adds what it has no place for: the
// month's counts above it and the Slot legend below. An entry opens its Title; a day or "+N more" switches to the Agenda at that day.
import { MonthView as DesignMonthView, type MonthViewEntry } from '@hyprsh/design'
import { dayString, localDay, type UpcomingItem } from '../api/upcoming'
import { plural } from '../format'
import { SlotLegend } from '../ui/slotState'
import { monthOf } from './MonthCalendar'
import { episodeCode, releaseName, upcomingKey, type EntryStatus } from './state'

const at = (day: string) => new Date(`${day}T12:00:00`)

/** The entry's mark: a Wanted entry is amber, red once Long Missing, a Grab blue, a file green; a release to come or one not monitored is grey. */
function tone({ kind, long }: EntryStatus): MonthViewEntry['tone'] {
  switch (kind) {
    case 'missing':
      return long ? 'error' : 'warning'
    case 'downloading':
      return 'info'
    case 'imported':
      return 'success'
    default:
      return 'neutral'
  }
}

/** Grey comes in two: a release still to come is a ring, an entry not monitored a solid dot (the label says which). */
function variant({ kind }: EntryStatus): MonthViewEntry['variant'] {
  return kind === 'searching' ? 'outline' : undefined
}

/** The entry's label (the Title and the code), with the tooltip and name that say all of it. */
function entryOf(item: UpcomingItem, status: EntryStatus, onOpenTitle: (id: number) => void): MonthViewEntry {
  const code = item.kind === 'series' ? episodeCode(item.season!, item.episode!) : null
  const label = code ? `${item.title} ${code}` : item.title
  const what = item.kind === 'series' ? item.episode_name : item.release_type ? releaseName[item.release_type].toLowerCase() : null
  const tip = `${label}${what ? ` · ${what}` : ''} — ${status.label}`
  return {
    key: upcomingKey(item),
    date: at(localDay(item)),
    label: (
      <span title={tip} aria-label={tip}>
        {label}
      </span>
    ),
    tone: tone(status),
    variant: variant(status),
    onOpen: () => onOpenTitle(item.title_id),
  }
}

export function MonthDisplay({
  month,
  items,
  statusOf,
  onMonth,
  onDay,
  onOpenTitle,
}: {
  month: string
  items: readonly UpcomingItem[]
  statusOf: (item: UpcomingItem) => EntryStatus
  onMonth: (month: string) => void
  onDay: (day: string) => void
  onOpenTitle: (id: number) => void
}) {
  const here = items.filter((i) => localDay(i).slice(0, 7) === month.slice(0, 7))
  const searching = here.filter((i) => statusOf(i).kind === 'searching').length
  return (
    <section aria-label="Month" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto tab-clear px-8 py-6">
      <span className="label-14 text-gray-900">
        {plural(here.length, 'release')} · {searching} searched when out
      </span>
      <DesignMonthView
        label="Upcoming"
        month={at(month)}
        onMonthChange={(next) => onMonth(monthOf(dayString(0, next)))}
        firstDayOfWeek={1}
        entries={items.map((item) => entryOf(item, statusOf(item), onOpenTitle))}
        onDayOpen={(day) => onDay(dayString(0, day))}
      />
      <SlotLegend />
    </section>
  )
}

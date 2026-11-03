// chrome: domain-visual
// A Series' Version cards: the column heads of the season table (VersionTable.tsx) on a wide screen, one full-width card per row on a
// phone. A card says the Slot with its Profile, one line of state ("Downloading S05E09–E10 · 40% · 13 min left", "6 Wanted · next
// search in 1 d"), a bar of the Version's episodes with their count, and its actions (VersionActions.tsx). An Original Offer is a tag.
import { Pill, Popover } from '@hyprsh/design'
import { Languages } from 'lucide-react'
import { plural } from '../format'
import { span, until } from '../time'
import { barColor, StateBar } from './StateBar'
import { codeRuns, expandCodes } from './cellDetail'
import { OriginalOfferNote } from './OriginalOfferNote'
import { useSlotNames } from './slots'
import type { SlotDownloads } from './TitleDownloads'
import { VersionActions, type Version, type VersionProps } from './VersionActions'

/** A Series Version's episodes in words: what it is downloading, or "6 Wanted · next search in 1 d". Empty for a Version that has everything. */
function seriesState(v: Version, dl: SlotDownloads | null, now: number): { text: string; tone: string } {
  const c = v.coverage
  if (dl) {
    const eps = dl.items.flatMap((i) => expandCodes(i.episodes))
    const parts = [`Downloading${eps.length > 0 ? ` ${codeRuns(eps)}` : ''}`, dl.pct !== null ? `${dl.pct}%` : null, dl.eta !== null ? `${span(dl.eta * 1000)} left` : null]
    return { text: parts.filter(Boolean).join(' · '), tone: 'text-blue-900' }
  }
  if (!c) return { text: v.state === 'unmonitored' ? 'Not monitored' : '', tone: 'text-gray-900' }
  const parts = [
    c.wanted > 0 ? `${c.wanted} Wanted` : null,
    c.long_missing > 0 ? `${c.long_missing} Long Missing` : null,
    c.wanted > 0 && v.next_search_at ? `next search ${until(v.next_search_at, now)}` : null,
    c.unmonitored > 0 ? `${c.unmonitored} not monitored` : null,
  ].filter(Boolean)
  return { text: parts.join(' · '), tone: c.long_missing > 0 ? 'text-red-900' : c.wanted > 0 ? 'text-amber-900' : 'text-gray-900' }
}

/** A bar of a Version's episodes: Have gray, downloading blue, Wanted amber, Long Missing red, not monitored light gray; thin when it is complete. */
function CoverageBar({ v }: { v: Version }) {
  const c = v.coverage
  if (!c) return <span className="flex-1" />
  // The segments are disjoint: Long Missing counts once, here, not again as Wanted (a Grab in flight makes it downloading).
  const long = Math.max(0, c.long_missing - c.downloading_long_missing)
  const wanted = Math.max(0, c.wanted - c.downloading - long)
  const parts = [
    { key: 'filled', n: c.filled, color: barColor.filled },
    { key: 'downloading', n: c.downloading, color: barColor.downloading },
    { key: 'wanted', n: wanted, color: barColor.wanted },
    { key: 'long_missing', n: long, color: barColor.longMissing },
    { key: 'unmonitored', n: c.unmonitored, color: barColor.quiet },
  ]
  return (
    <span className="min-w-0 flex-1">
      <StateBar parts={parts} complete={c.filled > 0 && c.wanted === 0 && c.downloading === 0 && c.unmonitored === 0} />
    </span>
  )
}

/** The count beside a Version's bar, "54/56": the episodes it has of those out. */
function coverageCount(v: Version): string {
  const c = v.coverage
  const released = c ? c.episodes + c.unmonitored : 0
  return c && released > 0 ? `${c.filled}/${released}` : ''
}

/** What the card says of its Version in one sentence, for its name and the count's tooltip: "Standard: 54 of 56 episodes · 2 Wanted". */
function said(name: string, v: Version, state: string): string {
  const c = v.coverage
  const released = c ? c.episodes + c.unmonitored : 0
  return `${name}: ${c ? `${c.filled} of ${plural(released, 'episode')}${state ? ` · ${state}` : ''}` : state}`
}

/** The tag of an Original Offer on its Version's card: it opens the offer with Accept and Dismiss. */
export function OriginalOfferTag({ version: v }: { version: Version }) {
  if (!v.original_offer) return null
  return (
    <Popover
      trigger={
        <Pill size="sm" icon={<Languages aria-hidden className="size-3" />} onClick={() => {}} className="shrink-0 whitespace-nowrap">
          Original Offer
        </Pill>
      }
      label={`${v.slot} Original Offer`}
      position="bottom-start"
      width={380}
    >
      <OriginalOfferNote offer={v.original_offer} />
    </Popover>
  )
}

/**
 * The head of a Version's column on a wide screen: its Slot and Profile, its state line, the bar with the count and the actions.
 * The state line keeps two lines of room so the heads of the four Versions are as tall as one another.
 */
export function VersionHead({ version: v, downloads, now, marked, ...rest }: VersionProps & { version: Version; downloads: SlotDownloads | null; now: number; marked: boolean }) {
  const slots = useSlotNames()
  const name = slots.name(v.slot)
  const line = seriesState(v, downloads, now)
  const count = coverageCount(v)
  return (
    <div
      role="columnheader"
      aria-label={name}
      id={`version-${v.slot}`}
      data-current={marked ? '' : undefined}
      className={`flex min-w-0 flex-col gap-2.5 border-l border-gray-alpha-200 p-3.5 ${marked ? 'ring-2 ring-blue-700 ring-inset' : ''}`}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="heading-14 truncate">{name}</span>
        <span className="label-12 truncate text-gray-900">{rest.profileName(v.profile)}</span>
        <OriginalOfferTag version={v} />
      </span>
      <span className={`label-13 min-h-8 ${line.tone}`}>{line.text}</span>
      <span className="flex items-center gap-2">
        <CoverageBar v={v} />
        {count && (
          <span role="img" aria-label={said(name, v, line.text)} title={said(name, v, line.text)} className="label-12 text-gray-900 tabular-nums">
            {count}
          </span>
        )}
      </span>
      <VersionActions {...rest} version={v} downloads={downloads} phone={false} />
    </div>
  )
}

/** A Version's card on a phone, full width: its short label (the one its column carries in the table below), the name, the state line and the actions. */
export function VersionCard({ version: v, downloads, now, marked, ...rest }: VersionProps & { version: Version; downloads: SlotDownloads | null; now: number; marked: boolean }) {
  const slots = useSlotNames()
  const name = slots.name(v.slot)
  const line = seriesState(v, downloads, now)
  const count = coverageCount(v)
  return (
    <article
      role="listitem"
      aria-label={name}
      id={`version-${v.slot}`}
      data-current={marked ? '' : undefined}
      className={`flex flex-col gap-2 rounded-lg p-3 shadow-border ${marked ? 'ring-2 ring-blue-700' : ''}`}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="label-12-mono w-9 shrink-0 text-gray-900">{slots.short(v.slot)}</span>
        <span className="heading-14">{name}</span>
        <span className="label-12 min-w-0 flex-1 truncate text-gray-900">{rest.profileName(v.profile)}</span>
        <OriginalOfferTag version={v} />
        {count && (
          <span role="img" aria-label={said(name, v, line.text)} title={said(name, v, line.text)} className="label-12 text-gray-900 tabular-nums">
            {count}
          </span>
        )}
      </span>
      {line.text && <span className={`label-13 ${line.tone}`}>{line.text}</span>}
      <VersionActions {...rest} version={v} downloads={downloads} phone />
    </article>
  )
}

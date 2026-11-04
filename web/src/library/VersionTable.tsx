// chrome: domain-visual
// A Series' Versions and Seasons, as on a Movie's page: a card per Version (at most four, in Slot order) in a grid of two per row (one on
// a phone), with Add Version below them while a Slot is free, then the Seasons as a table of their own. The table's head row counts the
// seasons and episodes over a column per Version, headed by its name (a short label, STD or 4K, on a phone), and the rows below it
// (SeasonRows.tsx, EpisodeRows.tsx) have a cell per Version in the same columns, so one Version's state down a season or an episode
// reads straight down. A legend under the table names the dots.
import { Button } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { dotClass, type CellKind } from './CellButton'
import { AddVersion } from './ManageVersion'
import { useSlotNames, type SlotInfo } from './slots'
import { gridOf, TRACKS } from './tableGrid'
import { useTitleDownloads } from './TitleDownloads'
import type { ManualSearchTarget } from './TitleDetail'
import { VersionCard } from './VersionCards'

type Version = TitleDetail['versions'][number]

export function VersionTable({
  title,
  slots,
  profiles,
  profileName,
  onManualSearch,
  seasonCount,
  episodeCount,
  marked,
  filter,
  children,
}: {
  title: TitleDetail
  /** The Title's Slots in Slot order: one column each. */
  slots: SlotInfo[]
  profiles: Profile[]
  profileName: (key: string) => string
  onManualSearch: (target: ManualSearchTarget) => void
  seasonCount: number
  episodeCount: number
  /** The Slot the page was opened at (`?slot=`): its card is scrolled to and ringed. */
  marked: string | null
  /** The control that filters the seasons, above the table; it and the legend show only while there are season rows. */
  filter: ReactNode
  /** The rows under the head: seasons, or a note while there are none to show. */
  children: ReactNode
}) {
  const phone = usePhone()
  const now = useNow()
  const downloads = useTitleDownloads(title.id)
  const slotNames = useSlotNames()
  const [adding, setAdding] = useState(false)
  const versions = slots.flatMap((s) => title.versions.filter((v) => v.slot === s.key))
  const free = title.versions.length < slotNames.list.length && versions.length < TRACKS // a Slot is left without a Version
  const card = { title, profiles, profileName, onManualSearch }
  const grid = gridOf(slots.length, phone)

  const cardsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (marked) cardsRef.current?.querySelector(`#version-${CSS.escape(marked)}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [marked, title.id])

  return (
    <>
      <section ref={cardsRef} aria-label="Versions" className="flex flex-col gap-3">
        <h3 className="heading-16">Versions</h3>
        <div role="list" aria-label="Versions" className="grid grid-cols-2 items-stretch gap-4 max-sm:grid-cols-1 max-sm:gap-2.5">
          {versions.map((v: Version) => (
            <VersionCard key={v.id} {...card} version={v} downloads={downloads.slot(v.slot)} now={now} marked={marked === v.slot} />
          ))}
        </div>
        {free && (
          <div>
            <Button variant="tertiary" size="small" prefix={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
              Add Version
            </Button>
          </div>
        )}
        {adding && <AddVersion title={title} profiles={profiles} onClose={() => setAdding(false)} />}
      </section>
      <section aria-label="Seasons" className="flex flex-col gap-3">
        <h3 className="heading-16">Seasons</h3>
        {filter}
        <div role="table" aria-label="Seasons" className="rounded-lg shadow-border">
          <div role="row" style={grid.style} className={`${grid.className} rounded-t-lg border-b border-gray-alpha-200 bg-background-200`}>
            {phone ? (
              <span role="columnheader" className="label-12 py-2 pl-3 text-gray-900">
                Season
              </span>
            ) : (
              <span role="columnheader" className="label-13 truncate px-5 py-3 text-gray-900">
                {plural(seasonCount, 'season')} · {plural(episodeCount, 'episode')}
              </span>
            )}
            {slots.map((s) => (
              <span
                key={s.key}
                role="columnheader"
                aria-label={s.name}
                className={`flex items-end justify-center truncate text-center text-gray-900 ${phone ? 'label-12' : 'label-13 items-center px-1 py-3'}`}
              >
                {phone ? s.short : s.name}
              </span>
            ))}
            <span aria-hidden />
          </div>
          {children}
        </div>
        {filter && <Legend />}
      </section>
    </>
  )
}

const legend: { kind: Exclude<CellKind, 'done'>; label: string }[] = [
  { kind: 'wanted', label: 'Wanted' },
  { kind: 'downloading', label: 'Downloading' },
  { kind: 'out', label: 'Not out yet' },
  { kind: 'off', label: 'Not monitored' },
]

/** What the dots in the table's cells mean, in the colours the cells use. */
function Legend() {
  return (
    <ul aria-label="Legend" className="label-12 flex flex-wrap gap-x-4 gap-y-1 text-gray-900">
      {legend.map((l) => (
        <li key={l.kind} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${dotClass[l.kind]}`} />
          {l.label}
        </li>
      ))}
    </ul>
  )
}

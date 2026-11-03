// chrome: domain-visual
// A Series' Versions and Seasons as one table. The head row holds a card per Version (at most four, in Slot order) over its column, and
// the rows below it (SeasonRows.tsx, EpisodeRows.tsx) have a cell per Version in the same columns, so one Version's state down a
// season or an episode reads straight down. While the Series has fewer than four Versions the next column holds Add Version.
// On a phone the cards stack one per row above the table, whose Version columns shrink to a short label (STD, 4K) each.
import { Button } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Profile, TitleDetail } from '../api/queries'
import { plural } from '../format'
import { usePhone } from '../responsive'
import { useNow } from '../time'
import { AddVersion } from './ManageVersion'
import { useSlotNames, type SlotInfo } from './slots'
import { gridOf, TRACKS } from './tableGrid'
import { useTitleDownloads } from './TitleDownloads'
import type { ManualSearchTarget } from './TitleDetail'
import { VersionCard, VersionHead } from './VersionCards'

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

  const cardsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (marked) cardsRef.current?.querySelector(`#version-${CSS.escape(marked)}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [marked, title.id])

  const addVersion = (
    <Button variant="tertiary" size="small" prefix={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
      Add Version
    </Button>
  )
  return (
    <div ref={cardsRef} className="flex flex-col gap-3">
      {phone && (
        <>
          <div role="list" aria-label="Versions" className="flex flex-col gap-2.5">
            {versions.map((v: Version) => (
              <VersionCard key={v.id} {...card} version={v} downloads={downloads.slot(v.slot)} now={now} marked={marked === v.slot} />
            ))}
          </div>
          {free && addVersion}
        </>
      )}
      <div role="table" aria-label="Versions and seasons" className="rounded-lg shadow-border">
        <div role="row" style={grid.style} className={`${grid.className} rounded-t-lg border-b border-gray-alpha-200 bg-background-200`}>
          {phone ? (
            <>
              <span role="columnheader" className="label-12 py-2 pl-3 text-gray-900">
                Season
              </span>
              {slots.map((s) => (
                <span key={s.key} role="columnheader" aria-label={s.name} className="label-12 text-center text-gray-900">
                  {s.short}
                </span>
              ))}
              <span aria-hidden />
            </>
          ) : (
            <>
              <span role="columnheader" className="flex flex-col justify-end gap-0.5 p-4">
                <span className="label-13 text-gray-900">{plural(seasonCount, 'season')}</span>
                <span className="label-13 text-gray-900">{plural(episodeCount, 'episode')}</span>
              </span>
              {versions.map((v) => (
                <VersionHead key={v.id} {...card} version={v} downloads={downloads.slot(v.slot)} now={now} marked={marked === v.slot} />
              ))}
              {free && (
                <span role="columnheader" aria-label="Add Version" className="flex items-center justify-center border-l border-gray-alpha-200 p-3.5">
                  {addVersion}
                </span>
              )}
              {Array.from({ length: Math.max(0, TRACKS - versions.length - (free ? 1 : 0)) }, (_, i) => (
                <span key={`f${i}`} aria-hidden className="border-l border-gray-alpha-200" />
              ))}
              <span aria-hidden className="border-l border-gray-alpha-200" />
            </>
          )}
        </div>
        {children}
      </div>
      {adding && <AddVersion title={title} profiles={profiles} onClose={() => setAdding(false)} />}
    </div>
  )
}

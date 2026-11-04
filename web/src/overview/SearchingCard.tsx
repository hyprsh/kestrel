// The Searching card on the Overview: the running search pass (or the one that has just finished) and, under it, what is
// still Wanted: one quiet line with how many are Wanted and how many of those are Long Missing, which opens the Library on
// them, then the Long Missing Versions first and the ones Wanted longest, each with a Search now button.
import { Button, Icon, Progress } from '@hyprsh/design'
import { X } from 'lucide-react'
import { passResult, phaseOf, whereOf } from '../activity/SearchProgress'
import { useSearchNow } from '../api/grabs'
import type { SearchStatus } from '../api/search'
import { NowCard, NowEmpty, NowLine, NowList, NowRow, NowSub, NowTitle } from '../layout/NowCard'
import { SlotTag } from '../library/SlotPills'
import { useSlotNames } from '../library/slots'
import { TitlePoster } from '../poster'
import { placePath, useOpenPlace } from '../place'
import { useReport } from '../toasts'
import { until, useNow } from '../time'
import type { OverviewNav } from './nav'
import { wantedWhat, wantedWhy, type WantedItem } from './wanted'

type Pass = NonNullable<SearchStatus['pass']>
type LastPass = NonNullable<SearchStatus['last_pass']>

/** Where the Wanted line goes: the Library on its Long Missing filter, longest Wanted first, or on every Wanted one when none is. */
export const wantedLinePath = (longMissing: number) => (longMissing > 0 ? placePath('library', 'is:long_missing sort:wanted_since') : placePath('library', 'is:wanted'))

export function SearchingCard({
  pass,
  finished,
  onDismiss,
  nextPassAt,
  wanted,
  shown,
  wantedLoaded,
  searchIndex,
  nav,
  onOpenTitle,
}: {
  pass: Pass | null
  finished: LastPass | null
  onDismiss: () => void
  nextPassAt: string | null
  /** Every Wanted Version, and `shown` the ones listed. */
  wanted: WantedItem[]
  shown: WantedItem[]
  wantedLoaded: boolean
  /** The pass row's place in the j/k list (the Wanted line and its rows follow it, or take its place without a pass). */
  searchIndex: number
  nav: OverviewNav
  onOpenTitle: (id: number) => void
}) {
  const now = useNow()
  const openPlace = useOpenPlace()
  const hasPass = pass !== null || finished !== null
  const lineIndex = searchIndex + (hasPass ? 1 : 0)
  const wantedBase = lineIndex + 1
  const longMissing = wanted.filter((w) => w.longMissing).length
  return (
    <NowCard
      title="Searching"
      meta={nextPassAt && !pass ? `next pass ${until(nextPassAt, now)}` : undefined}
      link={{ label: 'All Wanted', onOpen: () => openPlace(placePath('library', 'is:wanted')) }}
    >
      {hasPass && (
        <NowList>
          {pass && <PassRow pass={pass} nav={nav} index={searchIndex} onOpenTitle={onOpenTitle} />}
          {finished && <FinishedRow pass={finished} onDismiss={onDismiss} nav={nav} index={searchIndex} />}
        </NowList>
      )}
      {!wantedLoaded ? null : wanted.length === 0 ? (
        !hasPass && <NowEmpty>Nothing Wanted</NowEmpty>
      ) : (
        <>
          <NowSub navIndex={lineIndex} current={lineIndex === nav.sel} onSelect={() => nav.select(lineIndex)} onOpen={() => openPlace(wantedLinePath(longMissing))}>
            {`Wanted ${wanted.length}${longMissing > 0 ? ` · ${longMissing} long missing` : ''}`}
          </NowSub>
          <NowList>
            {shown.map((w, n) => (
              <WantedRow key={w.versionId} item={w} now={now} nav={nav} index={wantedBase + n} onOpenTitle={onOpenTitle} />
            ))}
          </NowList>
        </>
      )}
    </NowCard>
  )
}

/** "Searching Wanted · Breaking Bad S05 · 4K", the bar, and "1 of 4 · 37 checked". */
function PassRow({ pass, nav, index, onOpenTitle }: { pass: Pass; nav: OverviewNav; index: number; onOpenTitle: (id: number) => void }) {
  const phase = phaseOf(pass)
  const c = pass.current
  const where = c ? whereOf(c) : null
  const now = c ? [`${c.title}${where ? ` ${where}` : ''}`, c.slot].filter(Boolean).join(' · ') : null
  return (
    <NowRow navIndex={index} current={index === nav.sel} onSelect={() => nav.select(index)} onOpen={() => c && onOpenTitle(c.title_id)}>
      <span className="label-14 min-w-0 truncate">
        <b className="font-medium">Searching {phase.name}</b>
        {now && <span className="text-gray-900"> · {now}</span>}
      </span>
      <span className="flex items-center gap-2.5">
        <Progress value={phase.done} max={Math.max(phase.total, 1)} type="success" height={4} aria-label="Search progress" className="min-w-0 flex-1" />
        <span className="label-12 shrink-0 text-right tabular-nums text-gray-900">{`${phase.done} of ${phase.total} · ${pass.releases_seen} checked`}</span>
      </span>
    </NowRow>
  )
}

/** The pass that has just ended, for a minute: "Search done: 4 searched · 37 releases checked · 1 Grab", with a × to dismiss it. */
function FinishedRow({ pass, onDismiss, nav, index }: { pass: LastPass; onDismiss: () => void; nav: OverviewNav; index: number }) {
  return (
    <NowRow
      navIndex={index}
      current={index === nav.sel}
      onSelect={() => nav.select(index)}
      data-search-done
      lead={<Icon name="search" />}
      right={
        <Button svgOnly variant="tertiary" size="small" aria-label="Dismiss" onClick={onDismiss}>
          <X />
        </Button>
      }
    >
      <span className="label-14 font-medium">{`Search done: ${passResult(pass)}`}</span>
    </NowRow>
  )
}

function WantedRow({ item, now, nav, index, onOpenTitle }: { item: WantedItem; now: number; nav: OverviewNav; index: number; onOpenTitle: (id: number) => void }) {
  const search = useSearchNow()
  const report = useReport()
  const slots = useSlotNames()
  // The first Slot is the Library's main copy and goes unnamed; any other says which Version is searched.
  const label = item.slot === slots.list[0]?.id || !slots.several ? item.title : `${item.title} ${slots.name(item.slot)}`
  return (
    <NowRow
      navIndex={index}
      current={index === nav.sel}
      onSelect={() => nav.select(index)}
      onOpen={() => onOpenTitle(item.titleId)}
      lead={<TitlePoster id={item.titleId} hasPoster={item.hasPoster} size="xs" />}
      right={
        <span className="flex items-center gap-2">
          {/* A neutral chip: every row here is Wanted, and the line under the Title says for how long. */}
          <SlotTag slot={item.slot} state={null} tip={`${slots.name(item.slot)}: ${item.longMissing ? 'Long Missing' : 'Wanted'}`} />
          <Button
            svgOnly
            variant="tertiary"
            size="small"
            aria-label={`Search ${label}`}
            disabled={search.isPending}
            onClick={() => void report(search.mutateAsync({ versionId: item.versionId }), { started: `Search started for ${item.title}`, failed: `Could not search ${item.title}` })}
          >
            <Icon name="search" />
          </Button>
        </span>
      }
    >
      <NowTitle name={item.title} what={wantedWhat(item)} />
      <NowLine>{wantedWhy(item, now)}</NowLine>
    </NowRow>
  )
}
